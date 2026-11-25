import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  Page, Card, ButtonGroup, Icon, IndexTable, Text, Badge, Button, Banner, Modal, TextField, Select, Toast,
  BlockStack, InlineStack, Popover, ActionList, Box, Spinner, useBreakpoints,
} from '@shopify/polaris';
import { MenuHorizontalIcon, SearchIcon, AlertTriangleIcon } from '@shopify/polaris-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { getMe } from '../../api/auth.js';
import useOnlineStatus from '../../hooks/useOnlineStatus.js';
import { getLocations } from '../../api/inventory.js';
import {
  getTasks, getTask, getTaskSummary, getAssignees, completeTask, uncompleteTask, reviewTask, unreviewTask,
  dismissTask, deleteTask, updateTask,
} from '../../api/tasks.js';
import { todayStr, addDays, weekStart, formatDay, formatDateTime } from '../../utils/storeDate.js';
import TaskFormModal from './TaskFormModal.jsx';
import RepeatsModal from './RepeatsModal.jsx';
import CalendarView from './CalendarView.jsx';

const DONE_BY_KEY = 'tasksDoneBy';
const STATUS = {
  todo: { label: 'To do' },
  today: { label: 'Due today', tone: 'warning' },
  overdue: { label: 'Overdue', tone: 'critical' },
  review: { label: 'Awaiting review', tone: 'info' },
  reviewed: { label: 'Reviewed', tone: 'success' },
  done: { label: 'Done', tone: 'success' },
  dismissed: { label: 'Dismissed' },
};
const RANK = { overdue: 0, today: 1, todo: 1, review: 2, done: 3, reviewed: 3, dismissed: 4 };
const OPEN = ['todo', 'today', 'overdue'];

const readDoneBy = () => { try { return localStorage.getItem(DONE_BY_KEY) || ''; } catch { return ''; } };
const saveDoneBy = (v) => { try { localStorage.setItem(DONE_BY_KEY, v); } catch { /* private mode: just don't remember */ } };

export default function Tasks() {
  const queryClient = useQueryClient();
  const online = useOnlineStatus();
  const { data: session } = useQuery({ queryKey: ['auth-me'], queryFn: getMe, staleTime: Infinity });
  const manager = session?.role === 'admin' || session?.role === 'manager';
  const today = todayStr();
  // Phones get one card per task (Polaris's condensed table). Mid widths (iPad portrait) fold the
  // assignee into the task cell so the action buttons are never pushed off the edge.
  // Layout follows the width of the page CONTENT, not the window: the nav sidebar takes ~230px, so a
  // 1000px window can leave only ~600px for the table and the action buttons got clipped.
  const { mdDown } = useBreakpoints();
  const boxRef = useRef(null);
  const [boxWidth, setBoxWidth] = useState(() => (typeof window === 'undefined' ? 1200 : window.innerWidth));
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setBoxWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const smDown = boxWidth < 720;            // cards instead of a table
  const showAssigneeColumn = manager && boxWidth >= 900;
  const showTaskDate = manager && boxWidth >= 1000;

  const { data: tasks = [], isLoading, error } = useQuery({ queryKey: ['tasks'], queryFn: () => getTasks(), refetchInterval: 60_000 });
  const { data: summary } = useQuery({ queryKey: ['task-summary'], queryFn: getTaskSummary, refetchInterval: 60_000 });
  const { data: assignees = [] } = useQuery({ queryKey: ['task-assignees'], queryFn: getAssignees, enabled: manager });
  const { data: locRes } = useQuery({ queryKey: ['locations'], queryFn: getLocations, enabled: manager });
  const locations = useMemo(() => locRes?.data || [], [locRes]);

  // Managers can switch to a month calendar; the choice lives in the URL (?view=calendar) so it survives a refresh.
  const [params, setParams] = useSearchParams();
  const calendar = manager && params.get('view') === 'calendar';
  const setCalendarOff = () => { if (calendar) setParams({}, { replace: true }); };
  const setView = (v) => setParams(v === 'calendar' ? { view: 'calendar' } : {}, { replace: true });

  const [tab, setTab] = useState(0);
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const [repeatsOpen, setRepeatsOpen] = useState(false);
  const [doneFor, setDoneFor] = useState(null);       // task awaiting the "Done by" prompt
  const [doneBy, setDoneBy] = useState('');
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(null);       // { kind: 'dismiss'|'delete', task }
  const [detailId, setDetailId] = useState(null);
  const [menuFor, setMenuFor] = useState(null);

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    queryClient.invalidateQueries({ queryKey: ['task-summary'] });
  }, [queryClient]);
  const onError = (e) => { setToast({ message: e.message || 'That did not save', error: true }); refresh(); };

  const act = useMutation({
    mutationFn: ({ fn, task, body }) => fn(task.id, body),
    onSuccess: (_r, v) => { refresh(); setToast({ message: v.done || 'Saved' }); },
    onError,
  });

  const startDone = (task) => { setDoneBy(readDoneBy()); setNote(''); setDoneFor(task); };
  const confirmDone = () => {
    const task = doneFor;
    const name = doneBy.trim();
    if (name) saveDoneBy(name);
    setDoneFor(null);
    act.mutate({ fn: completeTask, task, body: { doneBy: name, note }, done: 'Marked done' });
  };

  const detail = useQuery({ queryKey: ['task', detailId], queryFn: () => getTask(detailId), enabled: !!detailId });

  // ── what the tabs show ──
  const wkStart = weekStart(today);
  const wkEnd = addDays(wkStart, 6);
  const tabs = [
    { id: 'week', content: 'This week', test: (t) => t.status === 'overdue' || (t.dueDate >= wkStart && t.dueDate <= wkEnd && t.status !== 'dismissed') },
    { id: 'open', content: 'To do', test: (t) => OPEN.includes(t.status) },
    { id: 'overdue', content: 'Overdue', test: (t) => t.status === 'overdue' },
    ...(manager ? [{ id: 'review', content: 'Awaiting review', test: (t) => t.status === 'review' }] : []),
    { id: 'done', content: 'Done', test: (t) => ['done', 'reviewed', 'dismissed'].includes(t.status) },
    { id: 'all', content: 'All', test: () => true },
  ];
  const current = tabs[tab] || tabs[0];

  // Assignee + search narrow every tab, so the chip counts always match what the tab will show.
  const base = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => (!assigneeFilter || t.assigneeId === assigneeFilter)
      && (!q || `${t.title} ${t.description || ''} ${t.assigneeName || ''}`.toLowerCase().includes(q)));
  }, [tasks, assigneeFilter, search]);
  const counts = tabs.map((t) => base.filter(t.test).length);
  const rows = useMemo(
    () => base.filter(current.test).sort((a, b) => (RANK[a.status] - RANK[b.status]) || a.dueDate.localeCompare(b.dueDate)),
    [base, current],
  );

  const assigneeOptions = useMemo(() => {
    const seen = new Map();
    tasks.forEach((t) => seen.set(t.assigneeId, t.assigneeName));
    return [{ label: 'Everyone', value: '' }, ...[...seen].map(([value, label]) => ({ label, value }))];
  }, [tasks]);

  const openNew = () => { setEditTask(null); setFormOpen(true); };
  const openEdit = (t) => { setEditTask(t); setFormOpen(true); setMenuFor(null); };

  const statusCell = (t) => {
    const s = STATUS[t.status];
    return (
      <BlockStack gap="050">
        <Badge tone={s.tone}>{s.label}</Badge>
        {t.completedAt && (
          <Text variant="bodySm" tone="subdued">
            {formatDateTime(t.completedAt)}{t.doneBy ? ` · ${t.doneBy}` : ` · ${t.completedByName}`}
          </Text>
        )}
        {t.reviewedAt && <Text variant="bodySm" tone="subdued">Reviewed {formatDateTime(t.reviewedAt)} · {t.reviewedByName}</Text>}
      </BlockStack>
    );
  };

  const actionCell = (t) => {
    const p = t.permissions;
    return (
      <InlineStack gap="200" blockAlign="center" wrap={false}>
        {p.canComplete && <Button variant="primary" size="large" onClick={() => startDone(t)} disabled={act.isPending || !online}>Mark done</Button>}
        {p.canUncomplete && <Button size="large" onClick={() => act.mutate({ fn: uncompleteTask, task: t, done: 'Marked not done' })} disabled={act.isPending || !online}>Undo</Button>}
        {p.canReview && <Button variant="primary" onClick={() => act.mutate({ fn: reviewTask, task: t, done: 'Approved' })} disabled={act.isPending || !online}>Approve</Button>}
        {p.canUnreview && <Button onClick={() => act.mutate({ fn: unreviewTask, task: t, done: 'Sent back for review' })} disabled={act.isPending || !online}>Send back</Button>}
        {(p.canEdit || p.canDismiss) && (
          <Popover
            active={menuFor === t.id} onClose={() => setMenuFor(null)}
            activator={<Button icon={MenuHorizontalIcon} accessibilityLabel={`More actions for ${t.title}`} onClick={() => setMenuFor(menuFor === t.id ? null : t.id)} />}
          >
            <ActionList items={[
              p.canEdit && { content: 'Edit', onAction: () => openEdit(t) },
              p.canDismiss && { content: 'Dismiss', onAction: () => { setMenuFor(null); setConfirm({ kind: 'dismiss', task: t }); } },
              p.canEdit && !t.ruleId && { content: 'Delete', destructive: true, onAction: () => { setMenuFor(null); setConfirm({ kind: 'delete', task: t }); } },
            ].filter(Boolean)}
            />
          </Popover>
        )}
      </InlineStack>
    );
  };

  const titleBlock = (t) => (
    <BlockStack gap="050">
      <Button variant="plain" textAlign="left" onClick={() => setDetailId(t.id)}>{t.title}</Button>
      {manager && !showAssigneeColumn && <Text variant="bodySm" tone="subdued">{t.assigneeName}</Text>}
      {t.description && <Text variant="bodySm" tone="subdued" truncate>{t.description}</Text>}
      <InlineStack gap="100">
        {t.ruleId && <Badge size="small">Repeats</Badge>}
        {t.needsReview && <Badge size="small" tone="info">Needs review</Badge>}
      </InlineStack>
    </BlockStack>
  );

  const dueText = (t) => (
    <InlineStack gap="100" blockAlign="center" wrap={false}>
      {t.status === 'overdue' && <Icon source={AlertTriangleIcon} tone="critical" />}
      <Text variant="bodyMd" as="span" tone={t.status === 'overdue' ? 'critical' : undefined} fontWeight={t.status === 'overdue' ? 'semibold' : 'regular'}>
        {formatDay(t.dueDate, today)}
      </Text>
    </InlineStack>
  );

  // Managers reassign an open task right in the list (only people who work at the task's location).
  const assigneeCell = (t) => {
    if (!t.permissions.canEdit) return t.assigneeName;
    const opts = assignees
      .filter((a) => a.role === 'admin' || !t.locationId || a.locationIds.includes(t.locationId))
      .map((a) => ({ label: a.displayName || a.username, value: a.id }));
    if (!opts.some((o) => o.value === t.assigneeId)) opts.unshift({ label: t.assigneeName, value: t.assigneeId });
    return (
      <Select
        label={`Assigned to for ${t.title}`} labelHidden options={opts} value={t.assigneeId} disabled={act.isPending || !online}
        onChange={(v) => act.mutate({ fn: updateTask, task: t, body: { assigneeId: v, locationId: t.locationId || undefined, scope: 'this' }, done: 'Reassigned' })}
      />
    );
  };

  // Phone: one card per task (title, due + status, then the buttons), controlled here rather than by the table.
  const cards = rows.map((t) => (
    <Box key={t.id} padding="400" borderBlockEndWidth="025" borderColor="border">
      <BlockStack gap="300">
        {titleBlock(t)}
        <InlineStack gap="300" blockAlign="start" wrap>
          {dueText(t)}
          {statusCell(t)}
        </InlineStack>
        {actionCell(t)}
      </BlockStack>
    </Box>
  ));

  const tableRows = rows.map((t, i) => (
    <IndexTable.Row id={t.id} key={t.id} position={i}>
      <IndexTable.Cell>{titleBlock(t)}</IndexTable.Cell>
      {showTaskDate && <IndexTable.Cell>{formatDay(t.taskDate, today)}</IndexTable.Cell>}
      <IndexTable.Cell>{dueText(t)}</IndexTable.Cell>
      {showAssigneeColumn && <IndexTable.Cell>{assigneeCell(t)}</IndexTable.Cell>}
      <IndexTable.Cell>{statusCell(t)}</IndexTable.Cell>
      <IndexTable.Cell>{actionCell(t)}</IndexTable.Cell>
    </IndexTable.Row>
  ));

  const headings = [{ title: 'Task' }, ...(showTaskDate ? [{ title: 'Task date' }] : []), { title: 'Due' }, ...(showAssigneeColumn ? [{ title: 'Assigned to' }] : []), { title: 'Status' }, { title: '' }];
  const confirmTask = confirm?.task;
  const fullToday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${today}T00:00:00Z`));
  const openCount = tasks.filter((t) => OPEN.includes(t.status)).length;
  const overdueCount = summary?.overdue ?? tasks.filter((t) => t.status === 'overdue').length;
  const subtitle = `${session?.kind === 'store' ? `${session.displayName || session.user} · ` : ''}${fullToday} · ${openCount} open · ${overdueCount} overdue`;

  return (
    <>
      {toast && <Toast content={toast.message} error={toast.error} onDismiss={() => setToast(null)} />}
      <Page
        title="Tasks"
        subtitle={subtitle}
        primaryAction={manager ? { content: 'New task', onAction: openNew } : undefined}
        secondaryActions={manager ? [{ content: 'Repeats', onAction: () => setRepeatsOpen(true) }] : []}
      >
        <div ref={boxRef}>
        <BlockStack gap="400">
          {error && <Banner tone="critical">{error.message}</Banner>}
          {summary?.overdue > 0 && (
            <Banner tone="critical" title={`${summary.overdue} overdue task${summary.overdue > 1 ? 's' : ''}`}
              action={{ content: 'Show them', onAction: () => { setCalendarOff(); setTab(tabs.findIndex((x) => x.id === 'overdue')); } }}
            />
          )}
          {manager && summary?.awaitingReview > 0 && (
            <Banner tone="info" title={`${summary.awaitingReview} task${summary.awaitingReview > 1 ? 's are' : ' is'} waiting for your review`}
              action={{ content: 'Show them', onAction: () => setTab(tabs.findIndex((x) => x.id === 'review')) }}
            />
          )}
          {manager && (
            <InlineStack align="end">
              <ButtonGroup variant="segmented">
                <Button pressed={!calendar} onClick={() => setView('list')}>List</Button>
                <Button pressed={calendar} onClick={() => setView('calendar')}>Calendar</Button>
              </ButtonGroup>
            </InlineStack>
          )}
          {calendar ? (
            <CalendarView
              today={today} smDown={smDown} assignees={assignees} assigneeFilter={assigneeFilter}
              onAssigneeChange={setAssigneeFilter} onOpenTask={setDetailId}
            />
          ) : (
          <Card padding="0">
            <Box padding="300" paddingBlockEnd="0">
              <InlineStack gap="150" wrap>
                {tabs.map((t, i) => (
                  <Button key={t.id} size={manager && !mdDown ? 'slim' : 'large'} pressed={tab === i} onClick={() => setTab(i)}>{`${t.content} ${counts[i]}`}</Button>
                ))}
              </InlineStack>
            </Box>
            <Box padding="300">
              <InlineStack gap="300" blockAlign="center" wrap>
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <TextField
                    label="Search tasks" labelHidden placeholder="Search tasks" value={search} onChange={setSearch} autoComplete="off"
                    prefix={<Icon source={SearchIcon} />} clearButton onClearButtonClick={() => setSearch('')}
                  />
                </div>
                {manager && assigneeOptions.length > 2 && (
                  <Select label="Assigned to" labelInline options={assigneeOptions} value={assigneeFilter} onChange={setAssigneeFilter} />
                )}
              </InlineStack>
            </Box>
            {isLoading ? (
              <Box padding="600"><InlineStack align="center"><Spinner accessibilityLabel="Loading tasks" /></InlineStack></Box>
            ) : smDown ? (
              <BlockStack gap="0">
                {cards}
                {rows.length === 0 && <Box padding="600"><Text tone="subdued" alignment="center">{current.id === 'done' ? 'Nothing finished yet.' : 'Nothing here. Nice work.'}</Text></Box>}
              </BlockStack>
            ) : (
              <IndexTable
                resourceName={{ singular: 'task', plural: 'tasks' }}
                itemCount={rows.length}
                selectable={false}
                headings={headings}
                emptyState={<Text tone="subdued">{current.id === 'done' ? 'Nothing finished yet.' : 'Nothing here. Nice work.'}</Text>}
              >
                {tableRows}
              </IndexTable>
            )}
          </Card>
          )}
        </BlockStack>
        </div>
      </Page>

      <Modal
        open={!!doneFor} onClose={() => setDoneFor(null)} title="Mark as done"
        primaryAction={{ content: 'Mark done', onAction: confirmDone }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setDoneFor(null) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text variant="bodyMd" fontWeight="semibold">{doneFor?.title}</Text>
            <TextField label="Who did this?" value={doneBy} onChange={setDoneBy} autoComplete="off" maxLength={80} helpText="Your name, so the team knows who to ask. We'll remember it on this device." />
            <TextField label="Note (optional)" value={note} onChange={setNote} multiline={2} maxLength={500} autoComplete="off" />
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Modal
        open={!!confirm} onClose={() => setConfirm(null)}
        title={confirm?.kind === 'delete' ? 'Delete this task?' : 'Dismiss this task?'}
        primaryAction={{
          content: confirm?.kind === 'delete' ? 'Delete' : 'Dismiss', destructive: true,
          onAction: () => {
            const { kind, task } = confirm;
            setConfirm(null);
            act.mutate({ fn: kind === 'delete' ? deleteTask : dismissTask, task, done: kind === 'delete' ? 'Task deleted' : 'Task dismissed' });
          },
        }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setConfirm(null) }]}
      >
        <Modal.Section>
          <Text as="p">
            {confirm?.kind === 'delete'
              ? `“${confirmTask?.title}” will be permanently deleted. This can't be undone.`
              : `“${confirmTask?.title}” will be cleared from the to-do and overdue lists and kept in history. It can't be reopened.`}
          </Text>
        </Modal.Section>
      </Modal>

      <Modal open={!!detailId} onClose={() => setDetailId(null)} title={detail.data?.title || 'Task'} secondaryActions={[{ content: 'Close', onAction: () => setDetailId(null) }]}>
        <Modal.Section>
          {detail.isLoading || !detail.data ? <Spinner accessibilityLabel="Loading" /> : (
            <BlockStack gap="300">
              {detail.data.description && <Text as="p">{detail.data.description}</Text>}
              <Text variant="bodySm" tone="subdued">
                Due {formatDay(detail.data.dueDate, today)} · Assigned to {detail.data.assigneeName} · Created by {detail.data.createdByName}
              </Text>
              {detail.data.completionNote && <Text as="p">Note: {detail.data.completionNote}</Text>}
              <Text variant="headingSm" as="h3">History</Text>
              {detail.data.events.length === 0 && <Text tone="subdued">No activity yet.</Text>}
              {detail.data.events.map((e) => (
                <Text key={e.id} variant="bodySm">
                  {formatDateTime(e.at)} · {e.event}{e.details?.doneBy ? ` (${e.details.doneBy})` : ''} · {e.actorName}
                </Text>
              ))}
            </BlockStack>
          )}
        </Modal.Section>
      </Modal>

      {manager && (
        <>
          <TaskFormModal
            open={formOpen} onClose={() => setFormOpen(false)} task={editTask} assignees={assignees} locations={locations}
            session={session} onSaved={(message) => setToast({ message })}
          />
          <RepeatsModal open={repeatsOpen} onClose={() => setRepeatsOpen(false)} />
        </>
      )}
    </>
  );
}
