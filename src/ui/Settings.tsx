import { useState } from "react";
import { cents, checked, hours, paydayInMonth, profileSnapshot } from "../domain/profile";
import type { Profile, Rules } from "../domain/profile";
import { DayOfMonthPicker } from "./TimePicker";
import { ScheduleFields } from "./ScheduleFields";
import { money, msg } from "./format";
import { SettingsIcon } from "./SettingsIcon";
type Panel = "root" | "income" | "schedule" | "startup" | "data";
type Item = { label: string; detail: string; icon: "wallet" | "clock" | "target" | "power" | "database"; open: () => void };
function SettingsRow({ item }: { item: Item }) {
  return <button type="button" className="settings-menu-row" onClick={item.open}>
    <span className="settings-menu-icon"><SettingsIcon name={item.icon} /></span>
    <span className="settings-menu-text"><strong>{item.label}</strong><small>{item.detail}</small></span>
    <span className="settings-menu-chevron"><SettingsIcon name="chevron" size={17} /></span>
  </button>;
}
function SettingsGroup({ title, items }: { title: string; items: Item[] }) {
  return <section className="settings-menu-group">
    <h2>{title}</h2><div className="settings-menu-card">{items.map(item => <SettingsRow key={item.label} item={item}/>)}</div>
  </section>;
}
export function Settings({
  profile, initial, save, close, reviewOnboarding, manageGoals,
  busy, now, auto, changeAutostart, clearData,
}: {
  profile: Profile;
  initial: Rules;
  save: (rules: Rules) => Promise<void>;
  close: () => void;
  reviewOnboarding: () => void;
  manageGoals: () => void;
  busy: boolean;
  now: Date;
  auto: boolean | null;
  changeAutostart: (enabled: boolean) => Promise<void>;
  clearData: () => Promise<void>;
}) {
  const [panel, setPanel] = useState<Panel>("root");
  const [draft, setDraft] = useState<Rules>(initial);
  const [salary, setSalary] = useState(String(initial.salaryCents / 100));
  const [bonus, setBonus] = useState(String((initial.attendanceCents ?? 0) / 100));
  const [error, setError] = useState("");
  const open = (to: Panel) => {
    setDraft(initial);
    setSalary(String(initial.salaryCents / 100));
    setBonus(String((initial.attendanceCents ?? 0) / 100));
    setError("");
    setPanel(to);
  };
  const back = () => { setError(""); if (panel === "root") close(); else setPanel("root"); };
  let candidate: Rules | undefined;
  let preview: ReturnType<typeof profileSnapshot> = null;
  if (panel === "income" || panel === "schedule") {
    try {
      const salaryCents = panel === "income" ? cents(salary.trim()) : draft.salaryCents;
      const attendanceCents = panel === "income"
        ? (/^0+(\.0{1,2})?$/.test(bonus.trim()) || !bonus.trim() ? 0 : cents(bonus.trim()))
        : draft.attendanceCents;
      const next = { ...draft, salaryCents, attendanceCents };
      checked(next);
      candidate = next;
      preview = profileSnapshot({ ...profile, settings: next }, now);
    } catch {
      // Keep editing an invalid draft without persisting a partial value.
    }
  }
  const saveChanges = async () => {
    if (!candidate || busy) return;
    setError("");
    try {
      await save(candidate);
      setDraft(candidate);
      setPanel("root"); // Secondary page returns to settings hub only on confirmed persistence.
    } catch (e) { setError(msg(e)); }
  };
  const heading = panel === "income" ? "工资与发薪"
    : panel === "schedule" ? "作息安排"
    : panel === "startup" ? "启动与驻留"
    : panel === "data" ? "数据与工具" : "设置";
  const groups: {title: string;items:Item[]}[] = [
    {title: "收入与工作", items: [
      {label: "工资与发薪",detail: `${money(initial.salaryCents/100)}/月 · ${initial.payday} 日发薪`,icon: "wallet",open:()=>open("income")},
      {label: "作息安排",detail: `每周 ${initial.weekdays.length} 天 · ${initial.shiftStart}–${initial.shiftEnd}`,icon:"clock",open:()=>open("schedule")},
    ]},
    {title: "个性化", items: [
      {label:"激励目标",detail: `管理内置与自定义目标`,icon:"target",open:manageGoals},
      {label:"启动与驻留",detail:auto===null?"正在读取启动状态":auto?"开机启动已开启":"开机启动已关闭",icon:"power",open:()=>open("startup")},
    ]},
    {title:"数据", items:[
      {label:"数据与工具",detail:"重新查看引导 · 本地数据",icon:"database",open:()=>open("data")},
    ]},
  ];
  return <div className="settings settings-redesign">
    <div className="row between page-heading">
      <h1>{heading}</h1><button type="button" onClick={back} disabled={busy}>返回</button>
    </div>
    {panel === "root" && <div className="settings-menu">
      {groups.map(group => <SettingsGroup key={group.title} {...group} />)}
    </div>}
    {(panel === "income" || panel === "schedule") && <form className="settings-editor" onSubmit={(e)=>{e.preventDefault();void saveChanges();}}>
      <fieldset disabled={busy} className="settings-fields">
        {panel === "schedule"
          ? <ScheduleFields draft={draft} change={setDraft}/>
          : <section className="card settings-finance">
              <label>税后月薪（元）
                <input aria-label="税后月薪（元）" inputMode="decimal" value={salary} onChange={e=>setSalary(e.target.value)}/>
              </label>
              <label>满勤奖金（元）
                <input aria-label="满勤奖金（元）" inputMode="decimal" value={bonus} onChange={e=>setBonus(e.target.value)}/>
              </label>
              <div className="settings-payday">
                <small>发薪日</small>
                <DayOfMonthPicker value={draft.payday} change={payday=>setDraft(current=>({...current,payday}))}/>
              </div>
              {paydayInMonth(draft.payday,now)!==draft.payday && <small>本月按 {paydayInMonth(draft.payday,now)} 日计算</small>}
              <div className="settings-income-preview">
                <small>预计时薪</small>
                <strong>{preview?money(preview.hourlyRate):"—"}</strong>
              </div>
            </section>}
        {panel === "schedule" && <small className="settings-note">每日有效工时：{hours(draft)}，自动按排班计算。</small>}
      </fieldset>
      {!candidate && <p className="error" role="status">请检查金额与排班后保存。</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="settings-actions">
        <button type="button" disabled={busy} onClick={back}>取消</button>
        <button className="primary" disabled={busy||!candidate}>保存修改</button>
      </div>
    </form>}
    {panel === "startup" && <section className="card settings-secondary-card">
      <div className="row between settings-toggle-row">
        <div className="settings-toggle-caption"><strong>开机启动</strong><small>登录电脑后自动运行</small></div>
        <button type="button" className="settings-switch" role="switch" aria-label="开机启动" aria-checked={auto ?? false}
          disabled={busy||auto===null}
          onClick={()=>void changeAutostart(!(auto??false)).catch(e=>setError(msg(e)))}>
          <span className="settings-switch-knob"/>
        </button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </section>}
    {panel === "data" && <div className="settings-data-sections">
      <section className="card settings-secondary-card">
        <button type="button" className="settings-secondary-action" onClick={reviewOnboarding} disabled={busy}>
          <SettingsIcon name="book"/><span>重新查看新手引导</span><SettingsIcon name="chevron" size={16}/>
        </button>
      </section>
      <section className="card settings-secondary-card settings-danger">
        <button type="button" disabled={busy} className="settings-secondary-action" onClick={()=>void clearData().catch(e=>setError(msg(e)))}>
          <SettingsIcon name="database"/><span>清空本地数据</span><SettingsIcon name="chevron" size={16}/>
        </button>
        <small>会删除工资、排班、提成、暂停和个人目标，操作前需再次确认。</small>
      </section>
      {error && <p className="error" role="alert">{error}</p>}
    </div>}
  </div>;
}
