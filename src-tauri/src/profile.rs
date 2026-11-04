use chrono::{NaiveDate, NaiveTime};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

const MAX_CENTS: u64 = 99_999_999_999;
const MAX_TIMESTAMP: i64 = 8_640_000_000_000_000;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    settings: Option<Rules>,
    onboarding_completed: Option<bool>,
    overrides: BTreeMap<String, Override>,
    pauses: Vec<Pause>,
    commissions: Vec<Commission>,
    pinned: bool,
    #[serde(default)]
    attendance_months: BTreeMap<String, bool>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Rules {
    salary_cents: u64,
    payday: u8,
    #[serde(default)]
    attendance_cents: u64,
    weekdays: Vec<u8>,
    shift_start: String,
    shift_end: String,
    lunch_start: String,
    lunch_end: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum Override {
    Work,
    Off,
    UnpaidLeave,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Pause {
    date_key: String,
    started_at: i64,
    ended_at: Option<i64>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Commission {
    id: String,
    date_key: String,
    amount_cents: u64,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    note: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    created_at: Option<i64>,
}

fn valid_date(value: &str) -> bool {
    value.len() == 10
        && NaiveDate::parse_from_str(value, "%Y-%m-%d")
            .is_ok_and(|date| date.format("%Y-%m-%d").to_string() == value)
}

fn valid_time(value: &str) -> Option<NaiveTime> {
    let time = NaiveTime::parse_from_str(value, "%H:%M").ok()?;
    (time.format("%H:%M").to_string() == value).then_some(time)
}

impl Rules {
    fn valid(&self) -> bool {
        let (Some(start), Some(lunch), Some(resume), Some(end)) = (
            valid_time(&self.shift_start),
            valid_time(&self.lunch_start),
            valid_time(&self.lunch_end),
            valid_time(&self.shift_end),
        ) else {
            return false;
        };
        self.salary_cents <= MAX_CENTS
            && self.attendance_cents <= MAX_CENTS
            && (1..=31).contains(&self.payday)
            && !self.weekdays.is_empty()
            && self.weekdays.iter().all(|d| (1..=7).contains(d))
            && self.weekdays.iter().collect::<HashSet<_>>().len() == self.weekdays.len()
            && start <= lunch
            && lunch < resume
            && resume <= end
            && (start < lunch || resume < end)
    }
}

impl Profile {
    pub fn migrate_onboarding(&mut self) -> bool {
        if self.onboarding_completed.is_some() {
            return false;
        }
        self.onboarding_completed = Some(
            self.settings
                .as_ref()
                .is_some_and(|rules| rules.salary_cents > 0),
        );
        true
    }

    pub fn validate(&self) -> Result<(), &'static str> {
        if self.onboarding_completed == Some(true)
            && !self
                .settings
                .as_ref()
                .is_some_and(|rules| rules.salary_cents > 0)
        {
            return Err("已完成引导的档案需要有效工资");
        }
        if self.settings.as_ref().is_some_and(|rules| !rules.valid()) {
            return Err("工资或班次无效");
        }
        if !self.overrides.keys().all(|date| valid_date(date)) {
            return Err("日期覆盖无效");
        }
        if !self
            .attendance_months
            .keys()
            .all(|month| month.len() == 7 && valid_date(&format!("{month}-01")))
        {
            return Err("满勤月份无效");
        }
        let mut open_dates = HashSet::new();
        for pause in &self.pauses {
            if !valid_date(&pause.date_key) || !(0..=MAX_TIMESTAMP).contains(&pause.started_at) {
                return Err("暂停记录无效");
            }
            match pause.ended_at {
                Some(end) if !(pause.started_at..=MAX_TIMESTAMP).contains(&end) => {
                    return Err("暂停结束时间无效");
                }
                None if !open_dates.insert(&pause.date_key) => {
                    return Err("当天已有未结束的暂停");
                }
                _ => {}
            }
        }
        let mut ids = HashSet::new();
        for entry in &self.commissions {
            if entry.id.is_empty()
                || !ids.insert(&entry.id)
                || !valid_date(&entry.date_key)
                || !(1..=MAX_CENTS).contains(&entry.amount_cents)
                || entry
                    .created_at
                    .is_some_and(|timestamp| !(0..=MAX_TIMESTAMP).contains(&timestamp))
                || entry.note.encode_utf16().count() > 100
            {
                return Err("提成记录无效");
            }
        }
        Ok(())
    }
}
