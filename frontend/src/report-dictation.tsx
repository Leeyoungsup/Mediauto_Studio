import { useEffect, useRef, useState } from 'react';

type Availability = 'available' | 'downloadable' | 'downloading' | 'unavailable';
type LocalOptions = { langs: string[]; processLocally: true; quality: 'dictation' };
type Recognition = {
  processLocally: boolean;
  quality?: 'dictation';
  lang: string;
  continuous: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type SpeechConstructor = {
  new(): Recognition;
  available?: (settings: LocalOptions) => Promise<Availability>;
  install?: (settings: LocalOptions) => Promise<boolean>;
};

function localSpeech(): SpeechConstructor | undefined {
  const browser = window as Window & { SpeechRecognition?: SpeechConstructor; webkitSpeechRecognition?: SpeechConstructor };
  const speech = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
  if (!window.isSecureContext || !speech?.available || !('processLocally' in speech.prototype)) return undefined;
  return speech;
}

export function ReportDictation({ sections, apply }: {
  sections: { key: string; label: string }[]; apply: (key: string, text: string) => boolean;
}) {
  const [language, setLanguage] = useState('en-US');
  const [text, setText] = useState('');
  const [section, setSection] = useState(sections[0]?.key ?? '');
  const [active, setActive] = useState(false);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState('');
  const recognition = useRef<Recognition | null>(null);
  const mounted = useRef(true);
  const speech = localSpeech();
  const options: LocalOptions = { langs: [language], processLocally: true, quality: 'dictation' };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (recognition.current) {
        recognition.current.onresult = null;
        recognition.current.onerror = null;
        recognition.current.onend = null;
        recognition.current.abort();
      }
      recognition.current = null;
    };
  }, []);

  async function install() {
    if (!speech?.install || active || working) return;
    setWorking(true);
    try {
      const installed = await speech.install(options);
      if (mounted.current) setStatus(installed ? 'Language pack ready.' : 'The language pack could not be installed.');
    } catch {
      if (mounted.current) setStatus('The language pack could not be installed.');
    } finally { if (mounted.current) setWorking(false); }
  }

  async function start() {
    if (!speech?.available || active || working) return;
    setWorking(true);
    setStatus('');
    try {
      const availability = await speech.available(options);
      if (!mounted.current) return;
      if (availability !== 'available') {
        setStatus(availability === 'unavailable' ? 'On-device dictation is unavailable for this language.'
          : 'Install the on-device language pack, then try again.');
        return;
      }
      const reader = new speech();
      reader.lang = language;
      reader.processLocally = true;
      if ('quality' in reader) reader.quality = 'dictation';
      reader.continuous = true;
      reader.onresult = (event) => {
        const received = Array.from(event.results).slice(event.resultIndex)
          .filter((result) => result.isFinal).map((result) => result[0].transcript.trim()).filter(Boolean);
        if (received.length) setText((value) => [value.trimEnd(), ...received].filter(Boolean).join(' ').slice(0, 12000));
      };
      reader.onerror = (event) => {
        if (event.error !== 'aborted') setStatus(event.error === 'not-allowed' || event.error === 'audio-capture'
          ? 'Allow microphone access and check the input device.' : 'On-device dictation ended. Review the text and try again.');
      };
      reader.onend = () => { recognition.current = null; setActive(false); };
      recognition.current = reader;
      reader.start();
      setActive(true);
    } catch {
      recognition.current = null;
      if (mounted.current) setStatus('Unable to start on-device dictation.');
    } finally { if (mounted.current) setWorking(false); }
  }

  return <details className="report-dictation">
    <summary>Dictation Draft</summary>
    <div className="history-manual">
      {speech ? <div className="actions">
        <label className="form-field">Dictation Language<select value={language} disabled={active || working}
          onChange={(event) => setLanguage(event.target.value)}>
          <option value="en-US">English</option><option value="ko-KR">Korean</option>
        </select></label>
        {speech.install && <button className="button secondary" type="button" disabled={active || working}
          onClick={() => void install()}>Install Language Pack</button>}
        <button className="button secondary" type="button" disabled={working || active} onClick={() => void start()}>Start Dictation</button>
        <button className="button secondary" type="button" disabled={!active} onClick={() => recognition.current?.stop()}>Stop Dictation</button>
      </div> : <p className="muted">On-device dictation requires a supported browser and a secure origin. You can paste transcript text below.</p>}
      {active && <p role="status">Listening on this device…</p>}
      {status && <p role="status">{status}</p>}
      <label className="form-field">Transcript Draft<textarea rows={4} value={text} maxLength={12000}
        onChange={(event) => setText(event.target.value)} /></label>
      <label className="form-field">Apply to Section<select value={section} onChange={(event) => setSection(event.target.value)}>
        {sections.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
      </select></label>
      <button className="button secondary" type="button" disabled={active || !text.trim() || !section}
        onClick={() => {
          if (apply(section, text.trim())) {
            setStatus('Transcript added to the editable draft. Review and save the report.');
            setText('');
          } else {
            setStatus('The transcript exceeds the available space in this section.');
          }
        }}>Apply Transcript to Section</button>
    </div>
  </details>;
}
