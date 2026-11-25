import { WEEKDAYS, formatDay } from '../../utils/storeDate.js';

export function describeRule(r) {
  const days = (r.daysOfWeek || []).map((d) => WEEKDAYS[d]).join(', ');
  let when;
  if (r.frequency === 'monthly') when = r.dayOfMonth === -1 ? 'Monthly, last day' : `Monthly, day ${r.dayOfMonth}`;
  else if (r.frequency === 'biweekly') when = `Every 2 weeks, ${days}`;
  else if ((r.daysOfWeek || []).length === 7) when = 'Daily';
  else when = r.frequency === 'daily' ? `Daily, ${days}` : `Weekly, ${days}`;
  const lead = r.leadDays ? ` · appears ${r.leadDays} day${r.leadDays > 1 ? 's' : ''} early` : '';
  let end = '';
  if (r.endType === 'date') end = ` · until ${formatDay(r.endDate)}`;
  if (r.endType === 'count') end = ` · ${r.endCount} times`;
  return `${when}${lead}${end}`;
}
