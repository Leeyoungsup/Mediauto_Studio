import { useState } from 'react';
import { ArrowLeft, ArrowRight, ClipboardList, FileSymlink, History, Plus, ScanLine, UserRound } from 'lucide-react';
import { doctors, readyCount } from './demo';
import type { DemoCase, Doctor } from './demo';
import { SlidePreview, StatusLabel } from './worklist';

export function CaseDetail({ item, emr, onBack, onViewer, onPatient, onAssign, onReview, onAddSlide }: {
  item: DemoCase; emr: string; onBack: () => void; onViewer: (slide?: string) => void;
  onPatient: () => void; onAssign: (doctor: Doctor | '') => void; onReview: () => void; onAddSlide: () => void;
}) {
  const [tab, setTab] = useState('슬라이드');
  const available = readyCount(item);

  return <>
    <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> Worklist</button>
    <div className="page-heading"><div><h1>{item.id}</h1><p>{item.specimen} · 접수 {item.received}</p></div>
      <div className="actions"><StatusLabel status={item.status} />
        {item.assignee && (item.status === '배정됨' || item.status === '검토 중') && <button className="button secondary" onClick={onReview}>{item.status === '배정됨' ? '검토 시작' : '검토 완료'}</button>}
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
          {!item.source && item.status !== '검토 완료' && <button className="button secondary" onClick={onAddSlide}><Plus size={15} /> 샘플 슬라이드 연결</button>}
        </div>
          {item.slides.length ? <div className="detail-slides">{item.slides.map((slide) => <button className="detail-slide" key={slide.id} onClick={() => onViewer(slide.id)}>
            <span className="slide-image"><SlidePreview slide={slide} /></span><span><strong>{slide.label ?? slide.id}</strong><small>검체 {slide.specimen} · {slide.stain}</small></span><span className="muted">{slide.state}</span><ArrowRight size={16} />
          </button>)}</div> : <div className="empty"><ScanLine size={27} /><strong>연결된 슬라이드가 없습니다.</strong></div>}
        </div>}
        {tab === '환자 정보' && <div className="detail-content"><div className="preview-label"><h2>환자 정보</h2>{item.source ? <a className="button secondary" href="#scans">슬라이드 등록에서 수정</a> : <button className="button secondary" onClick={onPatient}>{item.patient ? '수기 정보 수정' : '직접 입력'}</button>}</div>
          <p className="integration-note"><FileSymlink size={16} /> EMR {emr}{emr === '미설정' ? ' · 수기 등록을 사용할 수 있습니다.' : ''}</p>
          {item.patient ? <dl className="key-values"><div><dt>환자명</dt><dd>{item.patient.name || '미입력'}</dd></div><div><dt>환자번호</dt><dd>{item.patient.number || '미입력'}</dd></div><div><dt>생년월일</dt><dd>{item.patient.birth || '미입력'}</dd></div><div><dt>출처</dt><dd>{item.source ? '슬라이드 등록 정보' : '직접 입력'}</dd></div></dl> : <p className="empty-inline">표시할 환자 정보가 없습니다.</p>}
        </div>}
        {tab === '기록' && <div className="detail-content"><h2>케이스 이력</h2><ul className="timeline">{item.history.map((entry, index) => <li key={`${index}-${entry}`}>{entry}</li>)}</ul></div>}
      </section>
      <aside className="panel"><div className="panel-title"><h2>배정 정보</h2><ClipboardList className="muted" size={18} /></div>
        <div className="preview-content"><label className="form-field">담당 병리의<select value={item.assignee} disabled={Boolean(item.source) || item.status === '검토 완료'} onChange={(event) => onAssign(event.target.value as Doctor | '')}><option value="">미배정</option>{doctors.map((doctor) => <option key={doctor}>{doctor}</option>)}</select></label>
          <dl className="key-values"><div><dt>검토 상태</dt><dd><StatusLabel status={item.status} /></dd></div><div><dt>열람 가능</dt><dd>{available}/{item.slides.length}장</dd></div></dl>
        </div>
      </aside>
    </div>
  </>;
}
