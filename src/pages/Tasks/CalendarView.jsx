import React, { useState, useMemo } from 'react';
import {
  Card, Text, Button, ButtonGroup, Checkbox, Select, Badge, Modal, BlockStack, InlineStack, Box, Spinner, Banner, Icon,
} from '@shopify/polaris';
import { ChevronLeftIcon, ChevronRightIcon, RefreshIcon } from '@shopify/polaris-icons';
import { useQuery } from '@tanstack/react-query';
import { getTasks, getUpcoming } from '../../api/tasks.js';
import { addDays, weekdayMon0, WEEKDAYS, formatDay } from '../../utils/storeDate.js';
import { describeRule } from './ruleText.js';

// Month calendar for managers (design: the "Calendar view" board of the Tasks mockup). Each task sits on its
// due date. Repeats that have not been created yet are drawn dashed and can't be ticked.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MAX_CHIPS = 3;

// Calendar groups: the task statuses folded into the five the design uses.
const GROUP = {
  overdue: { label: 'Overdue', bg: 'var(--p-color-bg-fill-critical-secondary)', fg: 'var(--p-color-text-critical)' },
  today: { label: 'Due today', bg: 'var(--p-color-bg-fill-warning-secondary)', fg: 'var(--p-color-text-warning)' },
  ontrack: { label: 'On track', bg: 'var(--p-color-bg-fill-secondary)', fg: 'var(--p-color-text)' },
  review: { label: 'Awaiting review', bg: 'var(--p-color-bg-fill-info-secondary)', fg: 'var(--p-color-text-info)' },
  done: { label: 'Done', bg: 'var(--p-color-bg-fill-success-secondary)', fg: 'var(--p-color-text-success)' },
};
const ORDER = ['overdue', 'today', 'ontrack', 'review', 'done'];
const RANK = Object.fromEntries(ORDER.map((k, i) => [k, i]));
const PENDING = ['overdue', 'today', 'ontrack'];
const FILTERS = [['pending', 'Pending'], ['overdue', 'Overdue'], ['today', 'Due today'], ['ontrack', 'On track'], ['review', 'Awaiting review'], ['done', 'Done'], ['all', 'All']];
const toGroup = (status) => ({ todo: 'ontrack', reviewed: 'done' }[status] || status);

const monthStartOf = (day) => `${day.slice(0, 7)}-01`;
const shiftMonth = (first, n) => {
  const d = new Date(`${first}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n, 1);
  return d.toISOString().slice(0, 10);
};
const lastOfMonth = (first) => addDays(shiftMonth(first, 1), -1);
const dayNum = (s) => Number(s.slice(8));
const monthLabel = (first) => `${MONTHS[Number(first.slice(5, 7)) - 1]} ${first.slice(0, 4)}`;
const byStatus = (a, b) => (RANK[a.group] - RANK[b.group]) || a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title);
const byDue = (a, b) => a.dueDate.localeCompare(b.dueDate) || (RANK[a.group] - RANK[b.group]) || a.title.localeCompare(b.title);

function Chip({ item }) {
  const g = GROUP[item.group];
  return (
    <span style={{
      display: 'flex', alignItems: 'center', gap: 4, height: 22, padding: '0 6px', borderRadius: 6, boxSizing: 'border-box',
      fontSize: 12, fontWeight: 500, overflow: 'hidden', whiteSpace: 'nowrap', background: item.upcoming ? 'var(--p-color-bg-surface)' : g.bg,
      color: item.upcoming ? 'var(--p-color-text-secondary)' : g.fg,
      border: item.upcoming ? '1px dashed var(--p-color-border-secondary)' : '1px solid transparent',
    }}
    >
      {item.ruleId && <span style={{ width: 11, height: 11, flexShrink: 0, display: 'inline-flex' }}><Icon source={RefreshIcon} /></span>}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</span>
    </span>
  );
}

function Legend() {
  const swatch = (bg, border) => <span style={{ width: 14, height: 14, borderRadius: 4, background: bg, border }} />;
  return (
    <InlineStack gap="400" blockAlign="center" wrap>
      {ORDER.map((k) => (
        <InlineStack key={k} gap="150" blockAlign="center">{swatch(GROUP[k].bg, '1px solid var(--p-color-border)')}<Text variant="bodySm" as="span">{GROUP[k].label}</Text></InlineStack>
      ))}
      <InlineStack gap="150" blockAlign="center">{swatch('var(--p-color-bg-surface)', '1px dashed var(--p-color-border-secondary)')}<Text variant="bodySm" as="span">Upcoming repeat (not created yet)</Text></InlineStack>
    </InlineStack>
  );
}

export default function CalendarView({ today, smDown, assignees, assigneeFilter, onAssigneeChange, onOpenTask }) {
  const [monthFirst, setMonthFirst] = useState(monthStartOf(today));
  const [filter, setFilter] = useState('pending');
  const [showRepeats, setShowRepeats] = useState(true);
  const [selected, setSelected] = useState(null);
  const [sort, setSort] = useState('status');
  const [upcomingFor, setUpcomingFor] = useState(null);

  const monthLast = lastOfMonth(monthFirst);
  const gridStart = addDays(monthFirst, -weekdayMon0(monthFirst));
  const gridEnd = addDays(monthLast, 6 - weekdayMon0(monthLast));
  const cellDays = useMemo(() => {
    const out = [];
    for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) out.push(d);
    return out;
  }, [gridStart, gridEnd]);

  const tasksQ = useQuery({
    queryKey: ['tasks', 'range', gridStart, gridEnd],
    queryFn: () => getTasks({ from: gridStart, to: gridEnd, includeOld: true }),
    refetchInterval: 60_000,
  });
  const upcomingQ = useQuery({
    queryKey: ['tasks', 'upcoming', gridStart, gridEnd],
    queryFn: () => getUpcoming(gridStart, gridEnd),
    enabled: showRepeats,
    refetchInterval: 60_000,
  });

  const all = useMemo(() => {
    const real = (tasksQ.data || []).filter((t) => t.status !== 'dismissed').map((t) => ({ ...t, group: toGroup(t.status), upcoming: false }));
    const virtual = showRepeats
      ? (upcomingQ.data || []).map((o) => ({ ...o, id: `${o.ruleId}|${o.dueDate}`, group: 'ontrack', upcoming: true }))
      : [];
    return [...real, ...virtual].filter((t) => !assigneeFilter || t.assigneeId === assigneeFilter);
  }, [tasksQ.data, upcomingQ.data, showRepeats, assigneeFilter]);

  const inFilter = (t) => (filter === 'all' ? true : filter === 'pending' ? PENDING.includes(t.group) : t.group === filter);
  const monthTasks = all.filter((t) => t.dueDate >= monthFirst && t.dueDate <= monthLast);
  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, monthTasks.filter((t) => (k === 'all' ? true : k === 'pending' ? PENDING.includes(t.group) : t.group === k)).length]));
  const filterLabel = FILTERS.find(([k]) => k === filter)[1];

  const byDay = useMemo(() => {
    const m = new Map();
    all.filter(inFilter).forEach((t) => { if (!m.has(t.dueDate)) m.set(t.dueDate, []); m.get(t.dueDate).push(t); });
    m.forEach((list) => list.sort(byStatus));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, filter]);

  const panelItems = selected ? all.filter((t) => t.dueDate === selected) : monthTasks.filter(inFilter);
  const open = (t) => (t.upcoming ? setUpcomingFor(t) : onOpenTask(t.id));

  const itemRow = (t) => {
    const g = GROUP[t.group];
    const overdue = t.group === 'overdue';
    return (
      <button
        key={t.id} type="button" onClick={() => open(t)}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 8, border: 0, borderRadius: 8, background: 'transparent', textAlign: 'left', width: '100%', cursor: 'pointer', font: 'inherit', color: 'inherit' }}
      >
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
          <Text variant="bodySm" as="span" tone={overdue ? 'critical' : 'subdued'} fontWeight={overdue ? 'semibold' : 'regular'}>
            Due {formatDay(t.dueDate, today)} · {t.assigneeName}{t.upcoming ? ` · created ${formatDay(t.appearsOn, today)}` : ''}
          </Text>
          {t.upcoming && <Text variant="bodySm" as="span" tone="subdued">{describeRule(t)}</Text>}
        </span>
        {(selected || t.upcoming) && (
          <span style={{ padding: '0 8px', height: 22, display: 'inline-flex', alignItems: 'center', borderRadius: 999, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', background: t.upcoming ? 'var(--p-color-bg-surface)' : g.bg, color: t.upcoming ? 'var(--p-color-text-secondary)' : g.fg, border: t.upcoming ? '1px dashed var(--p-color-border-secondary)' : '1px solid transparent' }}>
            {t.upcoming ? 'Upcoming' : g.label}
          </span>
        )}
      </button>
    );
  };

  // Side panel: grouped by status (or one flat list by due date). On a phone this is the whole view.
  let panelBody;
  if (!panelItems.length) {
    panelBody = <Box padding="600"><Text tone="subdued" alignment="center">Nothing to show for this filter.</Text></Box>;
  } else if (smDown && !selected) {
    // agenda: day by day
    const days = [...new Set(panelItems.map((t) => t.dueDate))].sort();
    panelBody = days.map((d) => (
      <BlockStack key={d} gap="050">
        <Box paddingBlockStart="200" paddingInline="200"><Text variant="headingSm" as="h3" tone={d === today ? 'success' : undefined}>{d === today ? 'Today · ' : ''}{formatDay(d, today)}</Text></Box>
        {panelItems.filter((t) => t.dueDate === d).sort(byStatus).map(itemRow)}
      </BlockStack>
    ));
  } else if (sort === 'status' || selected) {
    panelBody = ORDER.map((k) => {
      const its = panelItems.filter((t) => t.group === k).sort(byDue);
      if (!its.length) return null;
      return (
        <BlockStack key={k} gap="050">
          <Box paddingBlockStart="200" paddingInline="200">
            <InlineStack gap="200" blockAlign="center">
              <span style={{ height: 22, padding: '0 8px', borderRadius: 999, background: GROUP[k].bg, color: GROUP[k].fg, fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>{GROUP[k].label}</span>
              <Text variant="bodySm" tone="subdued" as="span">{its.length}</Text>
            </InlineStack>
          </Box>
          {its.map(itemRow)}
        </BlockStack>
      );
    });
  } else {
    panelBody = [...panelItems].sort(byDue).map(itemRow);
  }

  const loading = tasksQ.isLoading;
  const assigneeOptions = [{ label: 'All staff', value: '' }, ...assignees.map((a) => ({ label: a.displayName || a.username, value: a.id }))];
  const panel = (
    <Card padding="0">
      <Box padding="400" borderBlockEndWidth="025" borderColor="border">
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="start" gap="200" wrap={false}>
            <BlockStack gap="050">
              <Text variant="headingMd" as="h2">{selected ? formatDay(selected, today) : `${filterLabel} · ${MONTHS[Number(monthFirst.slice(5, 7)) - 1]}`}</Text>
              <Text variant="bodySm" tone="subdued" as="span">
                {panelItems.length} {panelItems.length === 1 ? 'task' : 'tasks'}{selected ? ' on this day (all statuses)' : ''}
              </Text>
            </BlockStack>
            {selected && <Button size="slim" onClick={() => setSelected(null)}>Whole month</Button>}
          </InlineStack>
          {!selected && !smDown && (
            <Select label="Sort by" labelInline options={[{ label: 'Status (overdue first)', value: 'status' }, { label: 'Due date', value: 'due' }]} value={sort} onChange={setSort} />
          )}
        </BlockStack>
      </Box>
      <div style={{ maxHeight: smDown ? undefined : 760, overflowY: 'auto', padding: '4px 8px 12px' }}>{panelBody}</div>
    </Card>
  );

  return (
    <BlockStack gap="400">
      <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
        <InlineStack gap="300" blockAlign="center">
          <Text variant="headingXl" as="h2">{monthLabel(monthFirst)}</Text>
          <ButtonGroup>
            <Button icon={ChevronLeftIcon} accessibilityLabel="Previous month" onClick={() => { setMonthFirst(shiftMonth(monthFirst, -1)); setSelected(null); }} />
            <Button icon={ChevronRightIcon} accessibilityLabel="Next month" onClick={() => { setMonthFirst(shiftMonth(monthFirst, 1)); setSelected(null); }} />
            <Button onClick={() => { setMonthFirst(monthStartOf(today)); setSelected(today); }}>Today</Button>
          </ButtonGroup>
        </InlineStack>
        <InlineStack gap="300" blockAlign="center" wrap>
          <Checkbox label="Show upcoming repeats" checked={showRepeats} onChange={setShowRepeats} />
          <Select label="Assigned to" labelInline options={assigneeOptions} value={assigneeFilter} onChange={onAssigneeChange} />
        </InlineStack>
      </InlineStack>

      <InlineStack gap="150" wrap>
        {FILTERS.map(([k, label]) => (
          <Button key={k} size="slim" pressed={filter === k} onClick={() => { setFilter(k); setSelected(null); }}>{`${label} ${counts[k]}`}</Button>
        ))}
      </InlineStack>

      {(tasksQ.error || upcomingQ.error) && <Banner tone="critical">{(tasksQ.error || upcomingQ.error).message}</Banner>}

      {loading ? (
        <Box padding="600"><InlineStack align="center"><Spinner accessibilityLabel="Loading calendar" /></InlineStack></Box>
      ) : smDown ? panel : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
          <div style={{ flex: '999 1 560px', minWidth: 0 }}>
            <BlockStack gap="300">
              <Card padding="0">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', background: 'var(--p-color-bg-surface-secondary)', borderBottom: '1px solid var(--p-color-border)' }}>
                  {WEEKDAYS.map((w) => (
                    <div key={w} style={{ padding: '10px', fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--p-color-text-secondary)' }}>{w}</div>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
                  {cellDays.map((d, i) => {
                    const inMonth = d >= monthFirst && d <= monthLast;
                    const items = byDay.get(d) || [];
                    const isToday = d === today;
                    const isSel = selected === d;
                    return (
                      <button
                        key={d} type="button" aria-pressed={isSel} onClick={() => setSelected(isSel ? null : d)}
                        aria-label={`${formatDay(d, today)}, ${items.length} ${items.length === 1 ? 'task' : 'tasks'}`}
                        style={{
                          minHeight: 120, minWidth: 0, padding: 8, border: 0, borderRight: i % 7 === 6 ? 0 : '1px solid var(--p-color-border-secondary)',
                          borderBottom: '1px solid var(--p-color-border-secondary)', background: inMonth ? 'var(--p-color-bg-surface)' : 'var(--p-color-bg-surface-secondary)',
                          boxShadow: isSel ? 'inset 0 0 0 2px var(--p-color-border-focus)' : 'none', display: 'flex', flexDirection: 'column',
                          alignItems: 'stretch', gap: 4, textAlign: 'left', font: 'inherit', cursor: 'pointer', color: 'inherit',
                        }}
                      >
                        <span style={{
                          alignSelf: 'flex-start', minWidth: 26, height: 26, padding: '0 6px', boxSizing: 'border-box', borderRadius: 999,
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: isToday || inMonth ? 600 : 400,
                          background: isToday ? 'var(--p-color-bg-fill-brand)' : 'transparent',
                          color: isToday ? 'var(--p-color-text-brand-on-bg-fill)' : inMonth ? 'var(--p-color-text)' : 'var(--p-color-text-secondary)',
                        }}
                        >{dayNum(d)}</span>
                        {items.slice(0, MAX_CHIPS).map((t) => <Chip key={t.id} item={t} />)}
                        {items.length > MAX_CHIPS && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--p-color-text-link)', paddingLeft: 2 }}>+{items.length - MAX_CHIPS} more</span>}
                      </button>
                    );
                  })}
                </div>
              </Card>
              <Legend />
            </BlockStack>
          </div>
          <div style={{ flex: '1 1 300px', minWidth: 0 }}>{panel}</div>
        </div>
      )}

      <Modal
        open={!!upcomingFor} onClose={() => setUpcomingFor(null)} title={upcomingFor?.title || 'Upcoming repeat'}
        secondaryActions={[{ content: 'Close', onAction: () => setUpcomingFor(null) }]}
      >
        <Modal.Section>
          {upcomingFor && (
            <BlockStack gap="200">
              <Badge>Upcoming</Badge>
              {upcomingFor.description && <Text as="p">{upcomingFor.description}</Text>}
              <Text as="p">Due {formatDay(upcomingFor.dueDate, today)} · Assigned to {upcomingFor.assigneeName}</Text>
              <Text as="p" tone="subdued">{describeRule(upcomingFor)}. This one will be created automatically on {formatDay(upcomingFor.appearsOn, today)}; it can't be ticked until then.</Text>
            </BlockStack>
          )}
        </Modal.Section>
      </Modal>
    </BlockStack>
  );
}
