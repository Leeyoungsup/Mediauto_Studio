import { useState } from 'react';
import { ArrowLeft, ArrowRight, ClipboardList, FileSymlink, History, ScanLine, UserRound } from 'lucide-react';
import { readyCount } from './demo';
import type { DemoCase } from './demo';
import { SlidePreview, StatusLabel } from './worklist';

export function CaseDetail({ item, emr, onBack, onViewer }: {
  item: DemoCase; emr: string; onBack: () => void; onViewer: (slide?: string) => void;
}) {
  const [tab, setTab] = useState('슬라이드');
  const available = readyCount(item);

  return <>
    <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> Worklist</button>
    <div className="page-heading"><div><h1>{item.id}</h1><p>{item.specimen} · 접수 {item.received}</p></div>
      <div className="actions"><StatusLabel status={item.status} />
        <button className="button primary" disabled={!item.slides.length} onClick={() => onViewer()}><ScanLine size={17} /> 뷰어 열기</button>
      </div>
    </div>
    <div className="detail-layout">
      <section className="panel detail-panel">
        <nav className="detail-tabs" aria-label="케이스 정보">
          {[{ name: '슬라이드', icon: ScanLine }, { name: '환자 정보', icon: UserRound }, { name: '기록', icon: History }].map(({ name, icon: Icon }) =>
            <button key={name} aria-pressed={tab === name} onClick={() => setTab(name)}><Icon size={16} />{name}</button>)}
        </nav>
        {tab === '슬라이드' && <div className="detail-content"><div className="preview-label"><div className="title-inline"><h2>검체와 슬라이드</h2><span>{available}/{item.slides.length} 열람 가능</span></div>
        </div>
          {item.slides.length ? <div className="detail-slides">{item.slides.map((slide) => <button className="detail-slide" key={slide.id} onClick={() => onViewer(slide.id)}>
            <span className="slide-image"><SlidePreview slide={slide} /></span><span><strong>{slide.label ?? slide.id}</strong><small>검체 {slide.specimen} · {slide.stain}</small></span><span className="muted">{slide.state}</span><ArrowRight size={16} />
          </button>)}</div> : <div className="empty"><ScanLine size={27} /><strong>연결된 슬라이드가 없습니다.</strong></div>}
        </div>}
        {tab === '환자 정보' && <div className="detail-content"><div className="preview-label"><h2>환자 정보</h2>{item.source === 'files' && <a className="button secondary" href="#scans">슬라이드 등록에서 수정</a>}</div>
          <p className="integration-note"><FileSymlink size={16} /> EMR {emr}</p>
          {item.patient ? <dl className="key-values"><div><dt>환자명</dt><dd>{item.patient.name || '미입력'}</dd></div><div><dt>환자번호</dt><dd>{item.patient.number || '미입력'}</dd></div><div><dt>생년월일</dt><dd>{item.patient.birth || '미입력'}</dd></div><div><dt>출처</dt><dd>{item.source === 'files' ? '슬라이드 등록 정보' : '환자 기록'}</dd></div></dl> : <p className="empty-inline">표시할 환자 정보가 없습니다.</p>}
        </div>}
        {tab === '기록' && <div className="detail-content"><h2>케이스 이력</h2><ul className="timeline">{item.history.map((entry, index) => <li key={`${index}-${entry}`}>{entry}</li>)}</ul></div>}
      </section>
      <aside className="panel"><div className="panel-title"><h2>배정 정보</h2><ClipboardList className="muted" size={18} /></div>
        <div className="preview-content">
          <dl className="key-values"><div><dt>담당 병리의</dt><dd>{item.assignee || '미배정'}</dd></div><div><dt>검토 상태</dt><dd><StatusLabel status={item.status} /></dd></div><div><dt>열람 가능</dt><dd>{available}/{item.slides.length}장</dd></div></dl>
        </div>
      </aside>
    </div>
  </>;
}
