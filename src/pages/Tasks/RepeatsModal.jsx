import React, { useState } from 'react';
import { Modal, IndexTable, Text, Badge, Button, InlineStack, Banner, Toast } from '@shopify/polaris';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRules, pauseRule, resumeRule, endRule } from '../../api/tasks.js';
import { describeRule } from './ruleText.js';

const TONE = { active: 'success', paused: 'warning', ended: undefined };

// Lists the repeat rules the user may manage. Changing a repeat's wording or assignee is done by
// editing one of its tasks with "this and future tasks"; timing changes aren't in the UI yet.
export default function RepeatsModal({ open, onClose }) {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState(null);
  const { data: rules = [], isLoading, error } = useQuery({ queryKey: ['task-rules'], queryFn: getRules, enabled: open });

  const act = useMutation({
    mutationFn: ({ fn, id }) => fn(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-rules'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (e) => setToast({ message: e.message || 'That did not work', error: true }),
  });

  const rows = rules.map((r, i) => (
    <IndexTable.Row id={r.id} key={r.id} position={i}>
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="semibold">{r.title}</Text>
        <Text variant="bodySm" tone="subdued">{describeRule(r)}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{r.assigneeName}</IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={TONE[r.status]}>{r.status === 'paused' && r.pausedReason === 'assignee_inactive' ? 'Paused: assignee deactivated' : r.status[0].toUpperCase() + r.status.slice(1)}</Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="200" wrap={false}>
          {r.status === 'active' && <Button size="slim" onClick={() => act.mutate({ fn: pauseRule, id: r.id })}>Pause</Button>}
          {r.status === 'paused' && <Button size="slim" onClick={() => act.mutate({ fn: resumeRule, id: r.id })}>Resume</Button>}
          {r.status !== 'ended' && <Button size="slim" tone="critical" onClick={() => act.mutate({ fn: endRule, id: r.id })}>End</Button>}
        </InlineStack>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  const needsAttention = rules.filter((r) => r.status === 'paused' && r.pausedReason === 'assignee_inactive');

  return (
    <>
      {toast && <Toast content={toast.message} error={toast.error} onDismiss={() => setToast(null)} />}
      <Modal open={open} onClose={onClose} title="Repeating tasks" size="large" secondaryActions={[{ content: 'Close', onAction: onClose }]}>
        <Modal.Section>
          {error && <Banner tone="critical">{error.message}</Banner>}
          {needsAttention.length > 0 && (
            <Banner tone="warning" title={`${needsAttention.length} repeat${needsAttention.length > 1 ? 's are' : ' is'} paused because the assignee was deactivated`}>
              <p>Edit one of their tasks with “this and future tasks” to assign it to someone else, then resume the repeat.</p>
            </Banner>
          )}
          <IndexTable
            resourceName={{ singular: 'repeat', plural: 'repeats' }}
            itemCount={rules.length}
            selectable={false}
            loading={isLoading}
            headings={[{ title: 'Repeat' }, { title: 'Assigned to' }, { title: 'Status' }, { title: '' }]}
            emptyState={<Text tone="subdued">No repeating tasks yet. Create a task and choose how it repeats.</Text>}
          >
            {rows}
          </IndexTable>
        </Modal.Section>
      </Modal>
    </>
  );
}
