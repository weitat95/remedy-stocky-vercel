import React, { useState, useCallback, useMemo } from 'react';
import {
  Page, Card, IndexTable, Text, Badge, Banner, Spinner, Modal, TextField, Select,
  Checkbox, Toast, BlockStack, InlineStack,
} from '@shopify/polaris';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getUsers, createUser, updateUser } from '../../api/users.js';
import { getLocations } from '../../api/inventory.js';

const ROLE_OPTIONS = [
  { label: 'Retail (tasks only)', value: 'retail' },
  { label: 'Manager', value: 'manager' },
  { label: 'Admin', value: 'admin' },
];
const KIND_OPTIONS = [
  { label: 'Person', value: 'person' },
  { label: 'Store (shared login for one location)', value: 'store' },
];
const emptyForm = {
  username: '', displayName: '', role: 'retail', kind: 'person', active: true, locationIds: [], password: '',
};

export default function Users() {
  const queryClient = useQueryClient();
  const { data: users = [], isLoading, error } = useQuery({ queryKey: ['users'], queryFn: getUsers });
  const { data: locRes } = useQuery({ queryKey: ['locations'], queryFn: getLocations });
  const locations = useMemo(() => locRes?.data || [], [locRes]);
  const locationName = useCallback(
    (id) => locations.find((l) => l.id === id)?.name || id,
    [locations]
  );

  const [toast, setToast] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null); // user being edited, or null when creating
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState(null);

  const setField = useCallback((key) => (value) => setForm((f) => ({ ...f, [key]: value })), []);

  // A store account is always retail with exactly one location — keep the form consistent.
  const setKind = useCallback((kind) => setForm((f) => ({
    ...f, kind,
    role: kind === 'store' ? 'retail' : f.role,
    locationIds: kind === 'store' ? f.locationIds.slice(0, 1) : f.locationIds,
  })), []);

  const toggleLocation = useCallback((id, on) => setForm((f) => {
    if (f.kind === 'store') return { ...f, locationIds: on ? [id] : [] };
    return { ...f, locationIds: on ? [...f.locationIds, id] : f.locationIds.filter((x) => x !== id) };
  }), []);

  const openCreate = () => { setEditing(null); setForm(emptyForm); setFormError(null); setModalOpen(true); };
  const openEdit = (u) => {
    setEditing(u);
    setForm({ ...emptyForm, username: u.username, displayName: u.displayName || '', role: u.role, kind: u.kind, active: u.active, locationIds: u.locationIds });
    setFormError(null);
    setModalOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const base = {
        displayName: form.displayName, role: form.role, kind: form.kind, active: form.active, locationIds: form.locationIds,
      };
      if (editing) return updateUser(editing.id, form.password ? { ...base, password: form.password } : base);
      return createUser({ ...base, username: form.username, password: form.password });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setModalOpen(false);
      setToast({ message: editing ? 'User updated' : 'User added' });
    },
    onError: (err) => setFormError(err.message || 'Save failed'),
  });

  const needsLocation = form.role !== 'admin' || form.kind === 'store';

  const rows = users.map((u, index) => (
    <IndexTable.Row id={u.id} key={u.id} position={index} onClick={() => openEdit(u)}>
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="semibold">{u.displayName || u.username}</Text>
        {u.displayName && <Text variant="bodySm" tone="subdued">{u.username}</Text>}
      </IndexTable.Cell>
      <IndexTable.Cell>{u.role}</IndexTable.Cell>
      <IndexTable.Cell>{u.kind === 'store' ? 'Store' : 'Person'}</IndexTable.Cell>
      <IndexTable.Cell>
        {u.locationIds.length
          ? u.locationIds.map(locationName).join(', ')
          : <Text tone="subdued">All</Text>}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={u.active ? 'success' : undefined}>{u.active ? 'Active' : 'Inactive'}</Badge>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <>
      {toast && <Toast content={toast.message} onDismiss={() => setToast(null)} />}
      <Page
        title="Users"
        subtitle="Logins for managers, staff and shared store accounts. The owner's own login is set in the server environment and isn't listed here."
        primaryAction={{ content: 'Add user', onAction: openCreate }}
      >
        {error && <Banner tone="critical">{error.message}</Banner>}
        <Card padding="0">
          {isLoading ? (
            <InlineStack align="center"><Spinner accessibilityLabel="Loading users" /></InlineStack>
          ) : (
            <IndexTable
              resourceName={{ singular: 'user', plural: 'users' }}
              itemCount={users.length}
              selectable={false}
              headings={[
                { title: 'User' }, { title: 'Role' }, { title: 'Type' }, { title: 'Locations' }, { title: 'Status' },
              ]}
              emptyState={<Text tone="subdued">No users yet. Add one to give someone a login.</Text>}
            >
              {rows}
            </IndexTable>
          )}
        </Card>
      </Page>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${editing.username}` : 'Add user'}
        primaryAction={{ content: 'Save', onAction: () => saveMutation.mutate(), loading: saveMutation.isPending }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setModalOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            {formError && <Banner tone="critical">{formError}</Banner>}
            <TextField
              label="Username" value={form.username} onChange={setField('username')} autoComplete="off"
              disabled={!!editing} helpText="Lower case. 3–40 characters: letters, numbers, . _ -"
            />
            <TextField label="Display name" value={form.displayName} onChange={setField('displayName')} autoComplete="off" />
            <Select label="Type" options={KIND_OPTIONS} value={form.kind} onChange={setKind} />
            <Select label="Role" options={ROLE_OPTIONS} value={form.role} onChange={setField('role')} disabled={form.kind === 'store'} />
            {needsLocation && (
              <BlockStack gap="100">
                <Text variant="bodyMd" fontWeight="medium">
                  {form.kind === 'store' ? 'Location (exactly one)' : 'Locations'}
                </Text>
                {locations.map((l) => (
                  <Checkbox
                    key={l.id} label={l.name} checked={form.locationIds.includes(l.id)}
                    onChange={(on) => toggleLocation(l.id, on)}
                  />
                ))}
              </BlockStack>
            )}
            <TextField
              label={editing ? 'New password' : 'Password'} type="password" value={form.password}
              onChange={setField('password')} autoComplete="new-password"
              helpText={editing ? 'Leave blank to keep the current password. Minimum 8 characters.' : 'Minimum 8 characters.'}
            />
            <Checkbox label="Active" checked={form.active} onChange={setField('active')} helpText="Turning this off signs the user out immediately." />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </>
  );
}
