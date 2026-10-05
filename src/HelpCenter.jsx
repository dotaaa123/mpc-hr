import { useEffect, useState } from 'react';
import { Button, Modal, Progress, Segmented } from 'antd';
import { ArrowLeftOutlined, ArrowRightOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { pageGuides, roleJourneys } from './helpContent.js';
import './help.css';

export default function HelpCenter({ open, onClose, page, role, roleName, onNavigate, isMobile }) {
  const [mode, setMode] = useState('page');
  const [index, setIndex] = useState(0);
  useEffect(() => { if (open) { setMode('page'); setIndex(0); } }, [open, page]);
  const current = pageGuides[page] || pageGuides.dashboard;
  const journey = roleJourneys[role] || roleJourneys.hr;
  const steps = mode === 'page' ? current.steps : journey;
  const safeIndex = Math.min(index, steps.length - 1);
  const active = steps[safeIndex];
  const switchMode = value => { setMode(value); setIndex(0); };
  const next = () => setIndex(value => Math.min(steps.length - 1, value + 1));
  const previous = () => setIndex(value => Math.max(0, value - 1));
  const jump = () => {
    if (!active.page) return;
    onNavigate(active.page);
    setMode('page');
    setIndex(0);
  };

  return <Modal
    title={<span className="help-modal-title"><QuestionCircleOutlined/> Ашиглах заавар</span>}
    open={open}
    onCancel={onClose}
    footer={null}
    width={740}
    centered
    destroyOnHidden
    className="help-modal"
    styles={{ body: { maxHeight: isMobile ? '72dvh' : '78dvh', overflowY: 'auto' } }}
  >
    {role && <Segmented
      block
      value={mode}
      onChange={switchMode}
      options={[{ label: 'Энэ хуудас', value: 'page' }, { label: `${roleName || 'Миний'} ажлын дараалал`, value: 'journey' }]}
      className="help-mode"
    />}
    <div className="help-heading">
      <span className="help-kicker">{mode === 'page' ? 'ХУУДАСНЫ ЗААВАР' : 'ЭХЛЭХ ДАРААЛАЛ'}</span>
      <h2>{mode === 'page' ? current.title : `${roleName || 'Хэрэглэгч'}: эхнээс нь хийе`}</h2>
      <p>{mode === 'page' ? current.purpose : 'Алхам бүрийг дарааллаар нь уншаад хэрэгтэй хуудсаа нээнэ. Нэг алхмыг дуусгаад “Дараах” дар.'}</p>
    </div>
    <div className="help-progress-label"><strong>Алхам {safeIndex + 1} / {steps.length}</strong><span>{Math.round(((safeIndex + 1) / steps.length) * 100)}%</span></div>
    <Progress percent={((safeIndex + 1) / steps.length) * 100} showInfo={false} strokeColor="#7654d7" size="small" />
    <div className="help-step" aria-live="polite">
      <div className="help-step-number">{safeIndex + 1}</div>
      <div>
        <h3>{active.title}</h3>
        <p>{active.body}</p>
      </div>
    </div>
    <div className="help-map" aria-label="Алхамын зураглал">
      <span>Цэс</span><ArrowRightOutlined/><span>{mode === 'page' ? current.title : active.page && pageGuides[active.page]?.title || 'Хуудас'}</span><ArrowRightOutlined/><strong>{active.target}</strong>
    </div>
    {mode === 'page' && active.example && <div className="help-example"><strong>Жишээ</strong><p>{active.example}</p></div>}
    {mode === 'page' && current.reminder && <div className="help-reminder"><strong>Анхаарах зүйл</strong><p>{current.reminder}</p></div>}
    {mode === 'page' && current.actions?.length > 0 && <details className="help-actions"><summary>Энэ хуудасны товчнуудын тайлбар</summary><dl>{current.actions.map(([label,description],i)=><div key={`${label}-${i}`}><dt>{label}</dt><dd>{description}</dd></div>)}</dl></details>}
    <div className="help-footer">
      <Button onClick={previous} disabled={safeIndex === 0} icon={<ArrowLeftOutlined/>}>Өмнөх</Button>
      <div className="help-footer-right">
        {mode === 'journey' && active.page && <Button onClick={jump}>Хуудсыг нээх</Button>}
        {safeIndex < steps.length - 1 ? <Button type="primary" onClick={next}>Дараах <ArrowRightOutlined/></Button> : <Button type="primary" onClick={onClose}>Ойлголоо</Button>}
      </div>
    </div>
  </Modal>;
}
