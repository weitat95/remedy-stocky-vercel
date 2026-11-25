import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Modal, BlockStack, InlineStack, TextField, Select, Checkbox, ChoiceList, Banner, Text,
} from '@shopify/polaris';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createTask, updateTask } from '../../api/tasks.js';
import { todayStr, weekdayMon0, WEEKDAYS } from '../../utils/storeDate.js';

const REPEAT_OPTIONS = [
  { label: 'Does not repeat', value: 'none' },
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Every 2 weeks', value: 'biweekly' },
  { label: 'Monthly', value: 'monthly' },
];
const LEAD_OPTIONS = [
  { label: 'On the due date', value: '0' },
  { label: '1 day before', value: '1' },
  { label: '2 days before', value: '2' },
  { label: '3 days before', value: '3' },
  { label: '7 days before', value: '7' },
];
const END_OPTIONS = [
  { label: 'Never', value: 'never' },
  { label: 'On a date', value: 'date' },
  { label: 'After a number of times', value: 'count' },
];
const MONTH_DAYS = [
  ...Array.from({ length: 28 }, (_, i) => ({ label: `Day ${i + 1}`, value: String(i + 1) })),
  { label: 'Last day of the month', value: '-1' },
];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

const blank = () => {
  const today = todayStr();
  return {
    title: '', description: '', assigneeId: '', locationId: '', dueDate: today, needsReview: false,
    repeat: 'none', days: [weekdayMon0(today)], dayOfMonth: '1', leadDays: '0',
    endType: 'never', endDate: '', endCount: '10', scope: 'this',
  };
};

export default function TaskFormModal({ open, onClose, task, assignees, locations, session, onSaved }) {
  const queryClient = useQueryClient();
  const editing = !!task;
  const [form, setForm] = useState(blank);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(task ? {
      ...blank(), title: task.title, description: task.description || '', assigneeId: task.assigneeId,
      locationId: task.locationId || '', dueDate: task.dueDate, needsReview: task.needsReview,
    } : blank());
  }, [open, task]);

  const set = useCallback((k) => (v) => setForm((f) => ({ ...f, [k]: v })), []);

  const assigneeLabel = (u) => `${u.displayName || u.username}${u.kind === 'store' ? ' (store)' : ''}`;
  const assigneeOptions = useMemo(() => [
    { label: 'Choose who…', value: '', disabled: true },
    ...assignees.map((u) => ({ label: assigneeLabel(u), value: u.id })),
  ], [assignees]);

  // Locations offered = where the chosen assignee works, limited to the manager's own locations.
  const chosen = assignees.find((u) => u.id === form.assigneeId);
  const locationOptions = useMemo(() => {
    if (!chosen) return [];
    const mine = session.role === 'admin' ? chosen.locationIds : chosen.locationIds.filter((l) => (session.locationIds || []).includes(l));
    return mine.map((id) => ({ label: locations.find((l) => l.id === id)?.name || id, value: id }));
  }, [chosen, locations, session]);

  // Pick the location automatically when there's only one choice.
  useEffect(() => {
    if (!open || editing && form.locationId) return;
    if (locationOptions.length === 1 && form.locationId !== locationOptions[0].value) setForm((f) => ({ ...f, locationId: locationOptions[0].value }));
    if (locationOptions.length > 1 && !locationOptions.some((o) => o.value === form.locationId)) setForm((f) => ({ ...f, locationId: '' }));
  }, [open, editing, locationOptions, form.locationId]);

  const setRepeat = (value) => setForm((f) => ({
    ...f, repeat: value,
    days: value === 'daily' ? ALL_DAYS : (f.repeat === 'daily' || f.repeat === 'none' ? [weekdayMon0(f.dueDate || todayStr())] : f.days),
  }));
  const toggleDay = (d, on) => setForm((f) => ({ ...f, days: on ? [...new Set([...f.days, d])].sort() : f.days.filter((x) => x !== d) }));

  const save = useMutation({
    mutationFn: () => {
      if (editing) {
        const body = { title: form.title, description: form.description, needsReview: form.needsReview };
        if (form.dueDate !== task.dueDate) body.dueDate = form.dueDate; // unchanged past dates would be rejected
        if (form.assigneeId !== task.assigneeId || form.locationId !== (task.locationId || '')) {
          body.assigneeId = form.assigneeId;
          if (form.locationId) body.locationId = form.locationId;
        }
        if (task.ruleId) body.scope = form.scope;
        return updateTask(task.id, body);
      }
      const body = {
        title: form.title, description: form.description, assigneeId: form.assigneeId, dueDate: form.dueDate, needsReview: form.needsReview,
      };
      if (form.locationId) body.locationId = form.locationId;
      if (form.repeat !== 'none') {
        body.repeat = {
          frequency: form.repeat, leadDays: Number(form.leadDays), endType: form.endType,
          ...(form.repeat === 'monthly' ? { dayOfMonth: Number(form.dayOfMonth) } : { daysOfWeek: form.days }),
          ...(form.endType === 'date' && { endDate: form.endDate }),
          ...(form.endType === 'count' && { endCount: Number(form.endCount) }),
        };
      }
      return createTask(body);
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['task-summary'] });
      queryClient.invalidateQueries({ queryKey: ['task-rules'] });
      onSaved(editing ? 'Task updated' : res?.rule ? 'Repeating task created' : 'Task created');
      onClose();
    },
    onError: (e) => setError(e.message || 'Save failed'),
  });

  const showDays = !editing && ['daily', 'weekly', 'biweekly'].includes(form.repeat);

  return (
    <Modal
      open={open} onClose={onClose} title={editing ? 'Edit task' : 'New task'}
      primaryAction={{ content: editing ? 'Save changes' : 'Create task', onAction: () => save.mutate(), loading: save.isPending }}
      secondaryActions={[{ content: 'Cancel', onAction: onClose }]}
    >
      <Modal.Section>
        <BlockStack gap="300">
          {error && <Banner tone="critical">{error}</Banner>}
          <TextField label="Title" value={form.title} onChange={set('title')} maxLength={80} showCharacterCount autoComplete="off" />
          <TextField label="Description" value={form.description} onChange={set('description')} multiline={3} maxLength={500} autoComplete="off" />
          <Select label="Assigned to" options={assigneeOptions} value={form.assigneeId} onChange={set('assigneeId')} />
          {locationOptions.length > 1 && (
            <Select label="Location" options={[{ label: 'Choose a location…', value: '', disabled: true }, ...locationOptions]} value={form.locationId} onChange={set('locationId')} />
          )}
          <TextField label={!editing && form.repeat !== 'none' ? 'First due date' : 'Due date'} type="date" value={form.dueDate} onChange={set('dueDate')} autoComplete="off" />
          <Checkbox label="Needs manager review" helpText="After it's ticked, a manager checks and approves it." checked={form.needsReview} onChange={set('needsReview')} />

          {editing && task.ruleId && (
            <ChoiceList
              title="This task is part of a repeat"
              choices={[
                { label: 'This task only', value: 'this' },
                { label: 'This and future tasks', value: 'future', helpText: 'Changes the repeat. Tasks already created stay as they are.' },
              ]}
              selected={[form.scope]} onChange={(v) => set('scope')(v[0])}
            />
          )}

          {!editing && (
            <>
              <Select label="Repeat" options={REPEAT_OPTIONS} value={form.repeat} onChange={setRepeat} />
              {showDays && (
                <BlockStack gap="100">
                  <Text variant="bodyMd" fontWeight="medium">On these days</Text>
                  <InlineStack gap="300" wrap>
                    {WEEKDAYS.map((name, d) => <Checkbox key={name} label={name} checked={form.days.includes(d)} onChange={(on) => toggleDay(d, on)} />)}
                  </InlineStack>
                </BlockStack>
              )}
              {form.repeat === 'monthly' && <Select label="On" options={MONTH_DAYS} value={form.dayOfMonth} onChange={set('dayOfMonth')} />}
              {form.repeat !== 'none' && (
                <>
                  <Select label="Appears" options={LEAD_OPTIONS} value={form.leadDays} onChange={set('leadDays')} helpText="How early the task shows up on the list." />
                  <Select label="Ends" options={END_OPTIONS} value={form.endType} onChange={set('endType')} />
                  {form.endType === 'date' && <TextField label="Last due date" type="date" value={form.endDate} onChange={set('endDate')} autoComplete="off" />}
                  {form.endType === 'count' && <TextField label="Number of times" type="number" min={1} max={1000} value={form.endCount} onChange={set('endCount')} autoComplete="off" />}
                </>
              )}
            </>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
