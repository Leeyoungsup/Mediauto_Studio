import { useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ClipboardList, MessageSquare, FileSymlink, History, ScanLine, UserRound } from 'lucide-react';
import { CaseAudit } from './case-audit';
import { readyCount } from './demo';
import type { DemoCase } from './demo';
import { SlidePreview, StatusLabel } from './worklist';

export function CaseDetail({ item, emr, onBack, onViewer, onAssign, onReview, onConfirm, patientIntegration, requests, report, initialTab }: {
  item: DemoCase; emr: string; onBack: () => void; onViewer: (slide?: string) => void;
  onAssign?: () => void; onReview?: () => void; onConfirm?: () => void; patientIntegration?: ReactNode; requests?: ReactNode; report?: ReactNode; initialTab?: string;
}) {
  const [tab, setTab] = useState(initialTab ?? '슬라이드');
  const available = readyCount(item);

  return <>
    <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> Worklist</button>
    <div className="page-heading"><div><h1>{item.id}</h1><p>{item.specimen} · 접수 {item.received}</p></div>
      <div className="actions"><StatusLabel status={item.status} />
        {onReview && <button className="button secondary" disabled={!available} onClick={onReview}>{item.status === '검토 중' ? '검토 완료' : '검토 시작'}</button>}
        <button className="button primary" disabled={!available} onClick={() => onViewer()}><ScanLine size={17} /> 뷰어 열기</button>
      </div>
    </div>
    <div className="detail-layout">
      <section className="panel detail-panel">
        <nav className="detail-tabs" aria-label="케이스 정보">
          {[{ name: '슬라이드', icon: ScanLine }, { name: '환자 정보', icon: UserRound }, { name: '기록', icon: History },
            ...(requests ? [{ name: '요청', icon: MessageSquare }, { name: '보고 초안', icon: ClipboardList }] : [])].map(({ name, icon: Icon }) =>
            <button key={name} aria-pressed={tab === name} onClick={() => setTab(name)}><Icon size={16} />{name}</button>)}
        </nav>
        {tab === '슬라이드' && <div className="detail-content"><div className="preview-label"><div className="title-inline"><h2>검체와 슬라이드</h2><span>{available}/{item.slides.length} 열람 가능</span></div>
        </div>
          {item.slides.length ? <div className="detail-slides">{item.slides.map((slide) => <button className="detail-slide" key={slide.id} disabled={!slide.wsi} onClick={() => onViewer(slide.id)}>
            <span className="slide-image"><SlidePreview slide={slide} /></span><span><strong>{slide.label ?? slide.id}</strong><small>검체 {slide.specimen} · {slide.stain}{slide.wsi && ` · ${slide.wsi.format}`}</small></span><span className="muted">{slide.state}</span><ArrowRight size={16} />
          </button>)}</div> : <div className="empty"><ScanLine size={27} /><strong>연결된 슬라이드가 없습니다.</strong></div>}
        </div>}
        {tab === '환자 정보' && <div className="detail-content"><div className="preview-label"><h2>환자 정보</h2>{item.source === 'files' && <a className="button secondary" href="#scans">슬라이드 등록에서 수정</a>}</div>
          {!patientIntegration && <p className="integration-note"><FileSymlink size={16} /> EMR {emr}</p>}
          {item.patient ? <dl className="key-values"><div><dt>환자명</dt><dd>{item.patient.name || '미입력'}</dd></div><div><dt>환자번호</dt><dd>{item.patient.number || '미입력'}</dd></div>{item.patient.localRef && <div><dt>로컬 환자번호</dt><dd>{item.patient.localRef}</dd></div>}<div><dt>생년월일</dt><dd>{item.patient.birth || '미입력'}</dd></div><div><dt>출처</dt><dd>{item.source === 'files' ? '슬라이드 등록 정보' : '환자 기록'}</dd></div></dl> : <p className="empty-inline">표시할 환자 정보가 없습니다.</p>}
          {patientIntegration}
        </div>}
        {tab === '요청' && <div className="detail-content">{requests}</div>}
        {tab === '보고 초안' && <div className="detail-content">{report}</div>}
        {tab === '기록' && <div className="detail-content"><h2>케이스 이력</h2><CaseAudit item={item} /></div>}
      </section>
      <aside className="panel"><div className="panel-title"><h2>배정 정보</h2><ClipboardList className="muted" size={18} /></div>
        <div className="preview-content">
          <dl className="key-values"><div><dt>담당 병리의</dt><dd>{item.assignee || '미배정'}</dd></div><div><dt>검토 상태</dt><dd><StatusLabel status={item.status} /></dd></div><div><dt>열람 가능</dt><dd>{available}/{item.slides.length}장</dd></div></dl>
          {onAssign && <button className="button primary full" onClick={onAssign}>{item.assignedTo ? '재배정' : '담당자 배정'}</button>}
          {onConfirm && <button className="button secondary full" onClick={onConfirm}>등록 파일로 케이스 확정</button>}
        </div>
      </aside>
    </div>
  </>;
}
