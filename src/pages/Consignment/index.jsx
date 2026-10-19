import React, { useMemo, useState } from 'react';
import {
  Page, Card, IndexTable, Text, Button, Banner, Badge, Box, DataTable, Spinner,
  TextField, Select, InlineStack, BlockStack, Modal, Toast,
} from '@shopify/polaris';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getVendors } from '../../api/vendors.js';
import { getLocations } from '../../api/inventory.js';
import { getTemplates, createTemplate, updateTemplate, deleteTemplate, previewTemplate } from '../../api/consignment.js';

const EMPTY = { reportName: '', vendorId: '', locationId: '', timeFrame: 'last_month' };
const rm = (n) => Number(n ?? 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const errMsg = (err) => err.response?.data?.error || err.message;

function describeMargin(s) {
  const unit = s.valueType === 'percent' ? '%' : ' RM/unit';
  if (s.marginType === 'fixed') return `Fixed ${s.rate}${unit}`;
  return `Tiered (${s.tiers.map((t) => `≥ RM${t.from} → ${t.rate}${unit}`).join(', ')})`;
}

// Lines grouped by fulfilling location, a subtotal per group, then a grand total.
function buildRows(report) {
  const rows = [];
  const groups = new Map();
  for (const l of report.lines) {
    if (!groups.has(l.locationName)) groups.set(l.locationName, []);
    groups.get(l.locationName).push(l);
  }
  const bold = (v) => <Text as="span" fontWeight="semibold">{v}</Text>;
  const blank = (n) => Array(n).fill('');
  for (const [loc, lines] of groups) {
    rows.push([bold(loc), ...blank(10)]);
    let q = 0; let n = 0; let m = 0; let p = 0;
    for (const l of lines) {
      q += l.quantity; n += l.netSales; m += l.margin; p += l.payable;
      rows.push([
        l.orderDate, l.orderName, l.productTitle, l.variantTitle, l.sku || '—',
        <>{rm(l.rrp)}{l.rrpDerived && <> <Badge tone="attention">from cost</Badge></>}</>,
        l.quantity,
        <>{rm(l.netSales)}{l.discountRatio != null && l.discountRatio < 1 && <Text as="span" tone="subdued"> ({Math.round(l.discountRatio * 100)}%)</Text>}</>,
        rm(l.margin), rm(l.payable), '',
      ]);
    }
    rows.push([bold(`Subtotal ${loc}`), '', '', '', '', '', bold(q), bold(rm(n)), bold(rm(m)), bold(rm(p)), '']);
  }
  const t = report.totals;
  rows.push([bold('TOTAL'), '', '', '', '', '', bold(t.quantity), bold(rm(t.netSales)), bold(rm(t.margin)), bold(rm(t.payable)), '']);
  return rows;
}

function PreviewBody({ report, locationName }) {
  const t = report.totals;
  const rows = useMemo(() => buildRows(report), [report]);
  // Totals of a report with missing RRPs would read as a real zero — show a dash instead.
  const fig = (v) => (report.calculable ? `RM ${rm(v)}` : '—');
  return (
    <BlockStack gap="400">
      {!report.calculable && (
        <Banner tone="critical" title={`${report.missingRrp.length} SKU(s) have no vendor RRP — this report cannot be sent`}>
          <BlockStack gap="100">
            {report.missingRrp.map((m) => (
              <Text as="p" key={`${m.sku}-${m.productTitle}-${m.variantTitle}`}>
                {m.sku || '(no SKU)'} — {m.productTitle}{m.variantTitle ? ` / ${m.variantTitle}` : ''}
                {m.reason && <Text as="span" tone="subdued"> · {m.reason}</Text>}
              </Text>
            ))}
            <Text as="p" tone="subdued">Set them on the Vendor RRP page. Totals below exclude these lines.</Text>
          </BlockStack>
        </Banner>
      )}
      {report.derivedRrp && <Banner tone="warning">Some rows use an RRP derived from unit cost (marked "from cost").</Banner>}
      {report.warnings.length > 0 && <Banner tone="warning">{report.warnings.map((w) => <Text as="p" key={w}>{w}</Text>)}</Banner>}
      <Card>
        <BlockStack gap="200">
          <InlineStack gap="200" blockAlign="center">
            <Text as="h3" variant="headingMd">{report.vendor.name}</Text>
            {report.provisional && <Badge tone="attention">PROVISIONAL</Badge>}
          </InlineStack>
          <Text as="p" tone="subdued">
            {report.period.from} – {report.period.to} · {locationName} · margin in force from {report.setting.effectiveFrom}: {describeMargin(report.setting)} · {report.setting.promoMode === 'include' ? 'promo included' : 'promo excluded'}
          </Text>
          <InlineStack gap="600" wrap>
            <BlockStack><Text as="span" tone="subdued">Total sales (RRP)</Text><Text as="span" variant="headingMd">{fig(t.netSales)}</Text></BlockStack>
            <BlockStack><Text as="span" tone="subdued">Band reached</Text><Text as="span" variant="headingMd">{report.band && report.calculable ? `≥ RM${report.band.from} → ${report.band.rate}${report.setting.valueType === 'percent' ? '%' : ' RM/unit'}` : 'Fixed'}</Text></BlockStack>
            <BlockStack><Text as="span" tone="subdued">Margin</Text><Text as="span" variant="headingMd">{fig(t.margin)}</Text></BlockStack>
            <BlockStack><Text as="span" tone="subdued">Payable to vendor</Text><Text as="span" variant="headingMd">{fig(t.payable)}</Text></BlockStack>
          </InlineStack>
          {report.band && report.calculable && <Text as="p" tone="subdued">Band is picked from the vendor-wide total of RM {rm(report.vendorTotalSales)} across all locations{report.provisional ? ' (month-to-date)' : ''}.</Text>}
        </BlockStack>
      </Card>
      {!report.calculable && !report.lines.length ? null : report.zeroSales ? (
        <Banner tone="info">No sales for this period.</Banner>
      ) : (
        <Card padding="0">
          <DataTable
            columnContentTypes={['text', 'text', 'text', 'text', 'text', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric', 'text']}
            headings={['Date', 'Order', 'Product', 'Variant', 'SKU', 'RRP', 'Qty', 'Net sales', 'Margin', 'Payable', '']}
            rows={rows}
            hideScrollIndicator
          />
        </Card>
      )}
    </BlockStack>
  );
}

export default function Consignment() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(null); // { id?, ...fields }
  const [formError, setFormError] = useState(null);
  const [previewing, setPreviewing] = useState(null); // template
  const [toast, setToast] = useState(null);

  const { data: tpl, isLoading } = useQuery({ queryKey: ['consignment-templates'], queryFn: getTemplates });
  const templates = tpl?.data || [];
  const timeFrames = tpl?.timeFrames || [];
  const { data: vendors = [] } = useQuery({ queryKey: ['vendors', 'all'], queryFn: () => getVendors({ includeHidden: true }) });
  const { data: locationsData } = useQuery({ queryKey: ['locations'], queryFn: getLocations });
  const locations = locationsData?.data || [];
  const locName = (id) => (id ? locations.find((l) => l.id === id)?.name || id : 'All locations');
  const tfLabel = (v) => timeFrames.find((t) => t.value === v)?.label || v;

  const saveMutation = useMutation({
    mutationFn: (f) => (f.id ? updateTemplate(f.id, f) : createTemplate(f)),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['consignment-templates'] }); setForm(null); setToast('Template saved'); },
    onError: (err) => setFormError(errMsg(err)),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteTemplate,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['consignment-templates'] }); setToast('Template deleted'); },
    onError: (err) => setToast(errMsg(err)),
  });
  const previewQuery = useQuery({
    queryKey: ['consignment-preview', previewing?.id],
    queryFn: () => previewTemplate(previewing.id),
    enabled: !!previewing,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const openNew = () => { setFormError(null); setForm({ ...EMPTY }); };
  const openEdit = (t) => { setFormError(null); setForm({ id: t.id, reportName: t.reportName, vendorId: t.vendorId, locationId: t.locationId || '', timeFrame: t.timeFrame }); };

  return (
    <Page fullWidth title="Consignment Reports" subtitle="Vendor sales at vendor RRP, with the store's margin and the amount payable"
      primaryAction={{ content: 'New template', onAction: openNew }}>
      <Card padding="0">
        <IndexTable
          resourceName={{ singular: 'template', plural: 'templates' }}
          itemCount={templates.length}
          loading={isLoading}
          selectable={false}
          emptyState={<Box padding="400"><Text as="p" tone="subdued">No templates yet. A template is one vendor, an optional location, and a reporting time frame.</Text></Box>}
          headings={[{ title: 'Name' }, { title: 'Vendor' }, { title: 'Location' }, { title: 'Time frame' }, { title: '' }]}
        >
          {templates.map((t, i) => (
            <IndexTable.Row id={t.id} key={t.id} position={i}>
              <IndexTable.Cell><Text as="span" fontWeight="semibold">{t.reportName}</Text></IndexTable.Cell>
              <IndexTable.Cell>{t.vendor?.name}</IndexTable.Cell>
              <IndexTable.Cell>{locName(t.locationId)}</IndexTable.Cell>
              <IndexTable.Cell>{tfLabel(t.timeFrame)}</IndexTable.Cell>
              <IndexTable.Cell>
                <InlineStack gap="200" align="end">
                  <Button size="slim" variant="primary" onClick={() => setPreviewing(t)}>Preview</Button>
                  <Button size="slim" onClick={() => openEdit(t)}>Edit</Button>
                  <Button size="slim" tone="critical" onClick={() => deleteMutation.mutate(t.id)} loading={deleteMutation.isPending && deleteMutation.variables === t.id}>Delete</Button>
                </InlineStack>
              </IndexTable.Cell>
            </IndexTable.Row>
          ))}
        </IndexTable>
      </Card>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit template' : 'New template'}
        primaryAction={{ content: 'Save', onAction: () => { setFormError(null); saveMutation.mutate(form); }, loading: saveMutation.isPending }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setForm(null) }]}>
        {form && (
          <Modal.Section>
            <BlockStack gap="300">
              {formError && <Banner tone="critical">{formError}</Banner>}
              <TextField label="Report name" value={form.reportName} onChange={(v) => set({ reportName: v })} autoComplete="off" />
              <Select label="Vendor" value={form.vendorId} onChange={(v) => set({ vendorId: v })}
                options={[{ label: 'Select a vendor…', value: '' }, ...vendors.map((v) => ({ label: v.name, value: v.id }))]} />
              <Select label="Location" value={form.locationId} onChange={(v) => set({ locationId: v })}
                options={[{ label: 'All locations', value: '' }, ...locations.map((l) => ({ label: l.name, value: l.id }))]}
                helpText="Filters the lines shown. Tier bands still use the vendor's total across all locations." />
              <Select label="Reporting time frame" value={form.timeFrame} onChange={(v) => set({ timeFrame: v })}
                options={timeFrames.map((t) => ({ label: t.label, value: t.value }))} />
            </BlockStack>
          </Modal.Section>
        )}
      </Modal>

      <Modal open={!!previewing} onClose={() => setPreviewing(null)} size="large"
        title={previewing ? `Preview — ${previewing.reportName}` : ''}
        primaryAction={{ content: 'Close', onAction: () => setPreviewing(null) }}>
        <Modal.Section>
          {previewQuery.isLoading || previewQuery.isFetching ? (
            <InlineStack align="center"><Spinner /></InlineStack>
          ) : previewQuery.error ? (
            <Banner tone="critical" title="This report can't be generated">{errMsg(previewQuery.error)}</Banner>
          ) : previewQuery.data ? (
            <PreviewBody report={previewQuery.data} locationName={locName(previewing.locationId)} />
          ) : null}
        </Modal.Section>
      </Modal>
      {toast && <Toast content={toast} onDismiss={() => setToast(null)} duration={2500} />}
    </Page>
  );
}
