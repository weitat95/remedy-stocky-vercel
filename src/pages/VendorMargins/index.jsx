import React, { useState } from 'react';
import {
  Page, Card, IndexTable, Text, Button, Banner, Badge, Box, EmptyState,
  TextField, Select, InlineStack, BlockStack, Modal, Toast, Checkbox,
} from '@shopify/polaris';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getVendors } from '../../api/vendors.js';
import { getVendorMargins, saveVendorMargin, deleteVendorMargin } from '../../api/consignment.js';

const EMPTY_FORM = {
  effectiveFrom: '', active: true, marginType: 'fixed', valueType: 'percent',
  rate: '', tiers: [{ from: '0', rate: '' }], promoMode: 'exclude',
};

const dateStr = (d) => String(d).slice(0, 10);
const num = (n) => String(+Number(n).toFixed(4));

function describe(row) {
  if (!row.active) return 'Vendor inactive (discontinued)';
  const unit = row.valueType === 'percent' ? '%' : ' RM/unit';
  if (row.marginType === 'fixed') return `Fixed ${num(row.rate)}${unit}`;
  return `Tiered: ${(row.tiers || []).map((t) => `≥ RM${num(t.from)} → ${num(t.rate)}${unit}`).join(', ')}`;
}

export default function VendorMargins() {
  const queryClient = useQueryClient();
  const [vendorId, setVendorId] = useState('');
  const [form, setForm] = useState(null); // null = modal closed
  const [formError, setFormError] = useState(null);
  const [toast, setToast] = useState(null);

  const { data: vendors = [] } = useQuery({ queryKey: ['vendors', 'all'], queryFn: () => getVendors({ includeHidden: true }) });
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['vendor-margins', vendorId],
    queryFn: () => getVendorMargins(vendorId),
    enabled: !!vendorId,
  });

  const saveMutation = useMutation({
    mutationFn: saveVendorMargin,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-margins'] });
      setForm(null); setToast('Margin setting saved');
    },
    onError: (err) => setFormError(err.response?.data?.error || err.message),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteVendorMargin,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['vendor-margins'] }); setToast('Deleted'); },
    onError: (err) => setToast(err.response?.data?.error || err.message),
  });

  const openNew = () => { setFormError(null); setForm({ ...EMPTY_FORM }); };
  const openEdit = (r) => {
    setFormError(null);
    setForm({
      effectiveFrom: dateStr(r.effectiveFrom), active: r.active, marginType: r.marginType, valueType: r.valueType,
      rate: r.rate != null ? num(r.rate) : '',
      tiers: r.tiers?.length ? r.tiers.map((t) => ({ from: String(t.from), rate: String(t.rate) })) : [{ from: '0', rate: '' }],
      promoMode: r.promoMode,
    });
  };
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setTier = (i, patch) => setForm((f) => ({ ...f, tiers: f.tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)) }));

  const submit = () => {
    setFormError(null);
    saveMutation.mutate({
      vendorId, effectiveFrom: form.effectiveFrom, active: form.active,
      marginType: form.marginType, valueType: form.valueType, promoMode: form.promoMode,
      rate: form.rate,
      tiers: form.tiers.map((t) => ({ from: t.from, rate: t.rate })),
    });
  };

  const rateSuffix = form?.valueType === 'percent' ? '%' : 'RM / unit';

  return (
    <Page fullWidth title="Vendor Margins" subtitle="Consignment margin (the store's cut) per vendor, by effective date"
      primaryAction={{ content: 'Add setting', onAction: openNew, disabled: !vendorId }}>
      <BlockStack gap="400">
        <Card>
          <Select label="Vendor" value={vendorId} onChange={setVendorId}
            options={[{ label: 'Select a vendor…', value: '' }, ...vendors.map((v) => ({ label: v.name, value: v.id }))]} />
        </Card>
        <Banner tone="info">
          A report uses the row in force at the <b>start of its period</b>, so regenerating an old month never changes when margins change later.
          Tiered thresholds are the vendor's total sales for the template's reporting period — use them with monthly templates.
        </Banner>
        <Card padding="0">
          {!vendorId ? (
            <EmptyState heading="Pick a vendor" image=""><p>Choose a vendor to see its margin history.</p></EmptyState>
          ) : (
            <IndexTable
              resourceName={{ singular: 'setting', plural: 'settings' }}
              itemCount={rows.length}
              loading={isLoading}
              selectable={false}
              emptyState={<Box padding="400"><Text as="p" tone="subdued">No margin settings yet — reports for this vendor cannot be previewed or sent.</Text></Box>}
              headings={[{ title: 'Effective from' }, { title: 'Margin' }, { title: 'Promo' }, { title: '' }]}
            >
              {rows.map((r, i) => (
                <IndexTable.Row id={r.id} key={r.id} position={i}>
                  <IndexTable.Cell><Text as="span" fontWeight="semibold">{dateStr(r.effectiveFrom)}</Text></IndexTable.Cell>
                  <IndexTable.Cell>{describe(r)}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {r.active ? <Badge tone={r.promoMode === 'include' ? 'info' : undefined}>{r.promoMode === 'include' ? 'Include promo' : 'Exclude promo'}</Badge> : '—'}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <InlineStack gap="200" align="end">
                      <Button size="slim" onClick={() => openEdit(r)}>Edit</Button>
                      <Button size="slim" tone="critical" onClick={() => deleteMutation.mutate(r.id)} loading={deleteMutation.isPending && deleteMutation.variables === r.id}>Delete</Button>
                    </InlineStack>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>
      </BlockStack>

      <Modal open={!!form} onClose={() => setForm(null)} title="Margin setting"
        primaryAction={{ content: 'Save', onAction: submit, loading: saveMutation.isPending }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setForm(null) }]}>
        {form && (
          <Modal.Section>
            <BlockStack gap="300">
              {formError && <Banner tone="critical">{formError}</Banner>}
              <TextField label="Effective from" type="date" value={form.effectiveFrom} onChange={(v) => set({ effectiveFrom: v })}
                autoComplete="off" helpText="Saving a date that already exists replaces that row." />
              <Checkbox label="Vendor is inactive from this date" checked={!form.active} onChange={(v) => set({ active: !v })}
                helpText="Reports for periods starting on/after this date cannot be generated." />
              {form.active && (
                <>
                  <InlineStack gap="300">
                    <div style={{ flex: 1 }}>
                      <Select label="Margin type" value={form.marginType} onChange={(v) => set({ marginType: v })}
                        options={[{ label: 'Fixed commission', value: 'fixed' }, { label: 'Tiered', value: 'tiered' }]} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <Select label="Value type" value={form.valueType} onChange={(v) => set({ valueType: v })}
                        options={[{ label: 'Percentage of sales', value: 'percent' }, { label: 'Fixed RM per unit sold', value: 'per_unit' }]} />
                    </div>
                  </InlineStack>
                  {form.marginType === 'fixed' ? (
                    <TextField label={`Rate (${rateSuffix})`} type="number" min={0} value={form.rate} onChange={(v) => set({ rate: v })} autoComplete="off" />
                  ) : (
                    <BlockStack gap="200">
                      <Text as="p" tone="subdued">The whole amount earns the rate of the band reached (not marginal). Thresholds are the vendor's total sales (RM) across all locations.</Text>
                      {form.tiers.map((t, i) => (
                        <InlineStack key={i} gap="200" blockAlign="end">
                          <div style={{ flex: 1 }}>
                            <TextField label={i === 0 ? 'From total sales (RM)' : 'From (RM)'} type="number" min={0} value={t.from}
                              onChange={(v) => setTier(i, { from: v })} autoComplete="off" disabled={i === 0} />
                          </div>
                          <div style={{ flex: 1 }}>
                            <TextField label={`Rate (${rateSuffix})`} type="number" min={0} value={t.rate}
                              onChange={(v) => setTier(i, { rate: v })} autoComplete="off" />
                          </div>
                          <Button disabled={i === 0} onClick={() => set({ tiers: form.tiers.filter((_, j) => j !== i) })}>Remove</Button>
                        </InlineStack>
                      ))}
                      <InlineStack>
                        <Button onClick={() => set({ tiers: [...form.tiers, { from: '', rate: '' }] })}>Add tier</Button>
                      </InlineStack>
                    </BlockStack>
                  )}
                  <Select label="Promotions (Shopify discounts)" value={form.promoMode} onChange={(v) => set({ promoMode: v })}
                    options={[
                      { label: 'Exclude promo — store absorbs the discount', value: 'exclude' },
                      { label: 'Include promo — vendor shares the discount', value: 'include' },
                    ]} />
                </>
              )}
            </BlockStack>
          </Modal.Section>
        )}
      </Modal>
      {toast && <Toast content={toast} onDismiss={() => setToast(null)} duration={2500} />}
    </Page>
  );
}
