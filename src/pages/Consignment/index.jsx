import React, { useMemo, useState } from 'react';
import {
  Page, Card, IndexTable, Text, Button, Banner, Badge, Box, DataTable, Spinner,
  TextField, Select, InlineStack, BlockStack, Modal, Toast, Checkbox,
} from '@shopify/polaris';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getVendors } from '../../api/vendors.js';
import { getLocations } from '../../api/inventory.js';
import {
  getTemplates, createTemplate, updateTemplate, deleteTemplate, previewTemplate, exportTemplate,
  sendTemplateNow, getTemplateRuns, exportRun,
} from '../../api/consignment.js';

const EMPTY = {
  reportName: '', vendorId: '', locationId: '', timeFrame: 'last_month',
  toEmails: '', ccEmails: '', frequency: 'monthly', sendHour: '9', sendDay: '1', sendMonth: '1',
  ignoreIfZero: false, formats: ['xlsx'], enabled: false,
};
const FREQUENCY_OPTIONS = [
  { label: 'Daily', value: 'daily' }, { label: 'Monthly', value: 'monthly' },
  { label: 'Quarterly', value: 'quarterly' }, { label: 'Yearly', value: 'yearly' },
];
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({ label: `${String(h).padStart(2, '0')}:00`, value: String(h) }));
const MONTH_OPTIONS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  .map((label, i) => ({ label, value: String(i + 1) }));
const emailsToText = (arr) => (arr || []).join(', ');
const textToEmails = (str) => [...new Set(String(str || '').split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean))];

const STATUS_TONE = { sent: 'success', failed: 'critical', skipped: 'info', running: 'attention' };
const StatusBadge = ({ status }) => <Badge tone={STATUS_TONE[status]}>{status}</Badge>;
const fmtWhen = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short' });
const day = (iso) => String(iso).slice(0, 10);
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
  const COLS = 12;
  for (const [loc, lines] of groups) {
    rows.push([bold(loc), ...blank(COLS - 1)]);
    let q = 0; let n = 0; let m = 0; let p = 0;
    for (const l of lines) {
      q += l.quantity; n += l.netSales; m += l.margin; p += l.payable;
      rows.push([
        l.orderDate, l.orderName, l.locationName, l.vendor, l.productTitle, l.variantTitle, l.sku || '—',
        <>{rm(l.rrp)}{l.rrpDerived && <> <Badge tone="attention">from cost</Badge></>}</>,
        l.quantity,
        <>{rm(l.netSales)}{l.discountRatio != null && l.discountRatio < 1 && <Text as="span" tone="subdued"> ({Math.round(l.discountRatio * 100)}%)</Text>}</>,
        rm(l.margin), rm(l.payable),
      ]);
    }
    rows.push([bold(`Subtotal ${loc}`), ...blank(7), bold(q), bold(rm(n)), bold(rm(m)), bold(rm(p))]);
  }
  const t = report.totals;
  rows.push([bold('TOTAL'), ...blank(7), bold(t.quantity), bold(rm(t.netSales)), bold(rm(t.margin)), bold(rm(t.payable))]);
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
            columnContentTypes={['text', 'text', 'text', 'text', 'text', 'text', 'text', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric']}
            headings={['Date', 'Order', 'Location', 'Vendor', 'Product', 'Variant', 'SKU', 'RRP', 'Qty', 'Net sales', 'Margin', 'Payable']}
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
  const [sending, setSending] = useState(null); // template awaiting "Send now" confirmation
  const [historyFor, setHistoryFor] = useState(null); // template
  const [sendResult, setSendResult] = useState(null); // { template, run }
  const [toast, setToast] = useState(null);

  const { data: tpl, isLoading } = useQuery({ queryKey: ['consignment-templates'], queryFn: getTemplates });
  const templates = tpl?.data || [];
  const timeFrames = tpl?.timeFrames || [];
  const emailConfigured = tpl?.emailConfigured !== false;
  const { data: vendors = [] } = useQuery({ queryKey: ['vendors', 'all'], queryFn: () => getVendors({ includeHidden: true }) });
  const { data: locationsData } = useQuery({ queryKey: ['locations'], queryFn: getLocations });
  const locations = locationsData?.data || [];
  const locName = (id) => (id ? locations.find((l) => l.id === id)?.name || id : 'All locations');
  const tfLabel = (v) => timeFrames.find((t) => t.value === v)?.label || v;

  const saveMutation = useMutation({
    mutationFn: (f) => {
      const payload = { ...f, toEmails: textToEmails(f.toEmails), ccEmails: textToEmails(f.ccEmails) };
      return f.id ? updateTemplate(f.id, payload) : createTemplate(payload);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['consignment-templates'] }); setForm(null); setToast('Template saved'); },
    onError: (err) => setFormError(errMsg(err)),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteTemplate,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['consignment-templates'] }); setToast('Template deleted'); },
    onError: (err) => setToast(errMsg(err)),
  });
  const sendMutation = useMutation({
    mutationFn: (t) => sendTemplateNow(t.id),
    onSuccess: (run, t) => {
      setSending(null);
      setSendResult({ template: t, run });
      queryClient.invalidateQueries({ queryKey: ['consignment-templates'] });
      queryClient.invalidateQueries({ queryKey: ['consignment-runs'] });
    },
    onError: (err) => { setSending(null); setToast(errMsg(err)); },
  });
  const previewQuery = useQuery({
    queryKey: ['consignment-preview', previewing?.id],
    queryFn: () => previewTemplate(previewing.id),
    enabled: !!previewing,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const runsQuery = useQuery({
    queryKey: ['consignment-runs', historyFor?.id],
    queryFn: () => getTemplateRuns(historyFor.id),
    enabled: !!historyFor,
    staleTime: 0,
  });

  const [exportError, setExportError] = useState(null);
  const saveFile = ({ blob, filename }) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportError(null);
  };
  const exportMutation = useMutation({
    mutationFn: ({ id, format }) => exportTemplate(id, format),
    onSuccess: saveFile,
    onError: (err) => setExportError(errMsg(err)),
  });
  const runExportMutation = useMutation({
    mutationFn: ({ id, format }) => exportRun(id, format),
    onSuccess: saveFile,
    onError: (err) => setExportError(errMsg(err)),
  });
  const canExport = !!previewQuery.data && previewQuery.data.calculable && !previewQuery.isFetching;
  const exportingFormat = exportMutation.isPending ? exportMutation.variables?.format : null;

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const toggleFormat = (fmt, on) => setForm((f) => ({ ...f, formats: on ? [...new Set([...f.formats, fmt])] : f.formats.filter((x) => x !== fmt) }));
  const openNew = () => { setFormError(null); setForm({ ...EMPTY }); };
  const openEdit = (t) => {
    setFormError(null);
    setForm({
      id: t.id, reportName: t.reportName, vendorId: t.vendorId, locationId: t.locationId || '', timeFrame: t.timeFrame,
      toEmails: emailsToText(t.toEmails), ccEmails: emailsToText(t.ccEmails), frequency: t.frequency,
      sendHour: String(t.sendHour), sendDay: String(t.sendDay ?? 1), sendMonth: String(t.sendMonth ?? 1),
      ignoreIfZero: t.ignoreIfZero, formats: t.formats || ['xlsx'], enabled: t.enabled,
    });
  };

  const sendRecipients = sending ? textToEmails(emailsToText(sending.toEmails)) : [];

  return (
    <Page fullWidth title="Consignment Reports" subtitle="Vendor sales at vendor RRP, with the store's margin and the amount payable"
      primaryAction={{ content: 'New template', onAction: openNew }}>
      <BlockStack gap="400">
        {!emailConfigured && (
          <Banner tone="warning">Email isn't configured on the backend (RESEND_API_KEY / RESEND_FROM_EMAIL). Scheduled and manual sends will fail until it is.</Banner>
        )}
        {sendResult && (
          <Banner
            tone={sendResult.run?.status === 'sent' ? 'success' : sendResult.run?.status === 'skipped' ? 'info' : 'critical'}
            title={`${sendResult.template.reportName}: ${sendResult.run?.status}`}
            onDismiss={() => setSendResult(null)}
          >
            <BlockStack gap="100">
              {sendResult.run?.status === 'sent' && <Text as="p">Sent to {emailsToText(sendResult.template.toEmails)}{sendResult.template.ccEmails?.length ? ` (cc ${emailsToText(sendResult.template.ccEmails)})` : ''}.</Text>}
              {sendResult.run?.error && <Text as="p">{sendResult.run.error}</Text>}
              {sendResult.run?.skippedReason && <Text as="p">{sendResult.run.skippedReason}</Text>}
              {sendResult.run?.missingRrpSkus?.length > 0 && <Text as="p">Missing RRP: {sendResult.run.missingRrpSkus.join(', ')}</Text>}
            </BlockStack>
          </Banner>
        )}
        <Card padding="0">
          <IndexTable
            resourceName={{ singular: 'template', plural: 'templates' }}
            itemCount={templates.length}
            loading={isLoading}
            selectable={false}
            emptyState={<Box padding="400"><Text as="p" tone="subdued">No templates yet. A template is one vendor, an optional location, a reporting time frame and, optionally, an email schedule.</Text></Box>}
            headings={[{ title: 'Name' }, { title: 'Vendor' }, { title: 'Location' }, { title: 'Time frame' }, { title: 'Schedule' }, { title: 'Last run' }, { title: '' }]}
          >
            {templates.map((t, i) => {
              const last = t.runs?.[0];
              return (
                <IndexTable.Row id={t.id} key={t.id} position={i}>
                  <IndexTable.Cell><Text as="span" fontWeight="semibold">{t.reportName}</Text></IndexTable.Cell>
                  <IndexTable.Cell>{t.vendor?.name}</IndexTable.Cell>
                  <IndexTable.Cell>{locName(t.locationId)}</IndexTable.Cell>
                  <IndexTable.Cell>{tfLabel(t.timeFrame)}</IndexTable.Cell>
                  <IndexTable.Cell>{t.enabled ? t.scheduleLabel : <Text as="span" tone="subdued">Off</Text>}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {last ? (
                      <InlineStack gap="200" blockAlign="center">
                        <StatusBadge status={last.status} />
                        <Text as="span" tone="subdued">{fmtWhen(last.generatedAt)}</Text>
                      </InlineStack>
                    ) : <Text as="span" tone="subdued">—</Text>}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <InlineStack gap="200" align="end">
                      <Button size="slim" variant="primary" onClick={() => setPreviewing(t)}>Preview</Button>
                      <Button size="slim" onClick={() => setSending(t)}>Send now</Button>
                      <Button size="slim" onClick={() => { setExportError(null); setHistoryFor(t); }}>History</Button>
                      <Button size="slim" onClick={() => openEdit(t)}>Edit</Button>
                      <Button size="slim" tone="critical" onClick={() => deleteMutation.mutate(t.id)} loading={deleteMutation.isPending && deleteMutation.variables === t.id}>Delete</Button>
                    </InlineStack>
                  </IndexTable.Cell>
                </IndexTable.Row>
              );
            })}
          </IndexTable>
        </Card>
      </BlockStack>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit template' : 'New template'}
        primaryAction={{ content: 'Save', onAction: () => { setFormError(null); saveMutation.mutate(form); }, loading: saveMutation.isPending }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setForm(null) }]}>
        {form && (
          <>
            <Modal.Section>
              <BlockStack gap="300">
                {formError && <Banner tone="critical">{formError}</Banner>}
                <TextField label="Report name" value={form.reportName} onChange={(v) => set({ reportName: v })} autoComplete="off"
                  helpText="Also used in the email subject: [store name]_report name" />
                <Select label="Vendor" value={form.vendorId} onChange={(v) => set({ vendorId: v })}
                  options={[{ label: 'Select a vendor…', value: '' }, ...vendors.map((v) => ({ label: v.name, value: v.id }))]} />
                <Select label="Location" value={form.locationId} onChange={(v) => set({ locationId: v })}
                  options={[{ label: 'All locations', value: '' }, ...locations.map((l) => ({ label: l.name, value: l.id }))]}
                  helpText="Filters the lines shown. Tier bands still use the vendor's total across all locations." />
                <Select label="Reporting time frame" value={form.timeFrame} onChange={(v) => set({ timeFrame: v })}
                  options={timeFrames.map((t) => ({ label: t.label, value: t.value }))} />
              </BlockStack>
            </Modal.Section>
            <Modal.Section>
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">Email</Text>
                <TextField label="To" value={form.toEmails} onChange={(v) => set({ toEmails: v })} autoComplete="off" multiline={2}
                  helpText="Separate addresses with commas or new lines." />
                <TextField label="CC" value={form.ccEmails} onChange={(v) => set({ ccEmails: v })} autoComplete="off" multiline={2} />
                <BlockStack gap="100">
                  <Text as="span">Attachments</Text>
                  <InlineStack gap="400">
                    <Checkbox label="PDF" checked={form.formats.includes('pdf')} onChange={(v) => toggleFormat('pdf', v)} />
                    <Checkbox label="Excel" checked={form.formats.includes('xlsx')} onChange={(v) => toggleFormat('xlsx', v)} />
                  </InlineStack>
                </BlockStack>
                <Checkbox label="Ignore if zero sales" checked={form.ignoreIfZero} onChange={(v) => set({ ignoreIfZero: v })}
                  helpText="Skip generating and sending when the period has no sales." />
              </BlockStack>
            </Modal.Section>
            <Modal.Section>
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">Schedule</Text>
                <Checkbox label="Send automatically on this schedule" checked={form.enabled} onChange={(v) => set({ enabled: v })}
                  helpText="Only sends moments after you switch this on — it won't back-fill earlier ones. Times are Asia/Kuala_Lumpur." />
                <InlineStack gap="300" wrap>
                  <div style={{ minWidth: 150 }}><Select label="Frequency" value={form.frequency} onChange={(v) => set({ frequency: v })} options={FREQUENCY_OPTIONS} /></div>
                  {form.frequency === 'yearly' && (
                    <div style={{ minWidth: 150 }}><Select label="Month" value={form.sendMonth} onChange={(v) => set({ sendMonth: v })} options={MONTH_OPTIONS} /></div>
                  )}
                  {form.frequency !== 'daily' && (
                    <div style={{ width: 110 }}>
                      <TextField label="Day of month" type="number" min={1} max={31} value={form.sendDay} onChange={(v) => set({ sendDay: v })} autoComplete="off"
                        helpText="Short months use their last day" />
                    </div>
                  )}
                  <div style={{ minWidth: 120 }}><Select label="Time" value={form.sendHour} onChange={(v) => set({ sendHour: v })} options={HOUR_OPTIONS} /></div>
                </InlineStack>
                {form.frequency === 'quarterly' && <Text as="p" tone="subdued">Quarterly sends in the first month of each calendar quarter (Jan, Apr, Jul, Oct).</Text>}
              </BlockStack>
            </Modal.Section>
          </>
        )}
      </Modal>

      <Modal open={!!previewing} onClose={() => { setPreviewing(null); setExportError(null); }} size="large"
        title={previewing ? `Preview — ${previewing.reportName}` : ''}
        primaryAction={{ content: 'Close', onAction: () => { setPreviewing(null); setExportError(null); } }}
        secondaryActions={[
          { content: 'Download PDF', onAction: () => exportMutation.mutate({ id: previewing.id, format: 'pdf' }), disabled: !canExport || exportMutation.isPending, loading: exportingFormat === 'pdf' },
          { content: 'Download Excel', onAction: () => exportMutation.mutate({ id: previewing.id, format: 'xlsx' }), disabled: !canExport || exportMutation.isPending, loading: exportingFormat === 'xlsx' },
        ]}>
        <Modal.Section>
          {exportError && <Box paddingBlockEnd="300"><Banner tone="critical" onDismiss={() => setExportError(null)}>{exportError}</Banner></Box>}
          {previewQuery.isLoading || previewQuery.isFetching ? (
            <InlineStack align="center"><Spinner /></InlineStack>
          ) : previewQuery.error ? (
            <Banner tone="critical" title="This report can't be generated">{errMsg(previewQuery.error)}</Banner>
          ) : previewQuery.data ? (
            <PreviewBody report={previewQuery.data} locationName={locName(previewing.locationId)} />
          ) : null}
        </Modal.Section>
      </Modal>

      <Modal open={!!sending} onClose={() => setSending(null)} title={sending ? `Send "${sending.reportName}" now?` : ''}
        primaryAction={{ content: 'Send email', onAction: () => sendMutation.mutate(sending), loading: sendMutation.isPending, destructive: false }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setSending(null) }]}>
        <Modal.Section>
          {sending && (
            <BlockStack gap="200">
              <Text as="p">This generates the report for <b>{tfLabel(sending.timeFrame).toLowerCase()}</b> and emails it now, outside the schedule. It is recorded in the run history.</Text>
              <Text as="p"><b>To:</b> {sendRecipients.length ? sendRecipients.join(', ') : <Text as="span" tone="critical">no recipients — add some in Edit first</Text>}</Text>
              {sending.ccEmails?.length > 0 && <Text as="p"><b>CC:</b> {emailsToText(sending.ccEmails)}</Text>}
              <Text as="p"><b>Attachments:</b> {(sending.formats || []).map((f) => (f === 'pdf' ? 'PDF' : 'Excel')).join(' + ') || 'none selected'}</Text>
              {!emailConfigured && <Banner tone="warning">Email isn't configured on the backend — this will fail.</Banner>}
            </BlockStack>
          )}
        </Modal.Section>
      </Modal>

      <Modal open={!!historyFor} onClose={() => { setHistoryFor(null); setExportError(null); }} size="large"
        title={historyFor ? `Run history — ${historyFor.reportName}` : ''}
        primaryAction={{ content: 'Close', onAction: () => { setHistoryFor(null); setExportError(null); } }}>
        <Modal.Section>
          {exportError && <Box paddingBlockEnd="300"><Banner tone="critical" onDismiss={() => setExportError(null)}>{exportError}</Banner></Box>}
          {runsQuery.isLoading ? (
            <InlineStack align="center"><Spinner /></InlineStack>
          ) : !runsQuery.data?.length ? (
            <Text as="p" tone="subdued">No runs yet.</Text>
          ) : (
            <IndexTable
              resourceName={{ singular: 'run', plural: 'runs' }}
              itemCount={runsQuery.data.length}
              selectable={false}
              headings={[{ title: 'When' }, { title: 'Period' }, { title: 'Status' }, { title: 'Payable', alignment: 'end' }, { title: 'Details' }, { title: '' }]}
            >
              {runsQuery.data.map((r, i) => (
                <IndexTable.Row id={r.id} key={r.id} position={i}>
                  <IndexTable.Cell>
                    <BlockStack>
                      <Text as="span">{fmtWhen(r.generatedAt)}</Text>
                      <Text as="span" tone="subdued">{r.trigger === 'cron' ? 'Scheduled' : 'Manual'}</Text>
                    </BlockStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {day(r.periodFrom)} – {day(r.periodTo)}
                    {r.provisional && <> <Badge tone="attention">PROVISIONAL</Badge></>}
                  </IndexTable.Cell>
                  <IndexTable.Cell><StatusBadge status={r.status} /></IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" alignment="end">{r.totals && r.status !== 'failed' ? rm(r.totals.payable) : '—'}</Text></IndexTable.Cell>
                  <IndexTable.Cell>
                    <BlockStack gap="050">
                      {r.error && <Text as="span" tone="critical">{r.error}</Text>}
                      {r.skippedReason && <Text as="span" tone="subdued">{r.skippedReason}</Text>}
                      {r.missingRrpSkus?.length > 0 && <Text as="span" tone="subdued">Missing RRP: {r.missingRrpSkus.join(', ')}</Text>}
                      {r.derivedRrp && <Text as="span" tone="subdued">Some RRPs derived from cost</Text>}
                      {r.status === 'sent' && <Text as="span" tone="subdued">To {emailsToText(r.recipients?.to)}</Text>}
                    </BlockStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {r.status === 'sent' && (
                      <InlineStack gap="100" align="end">
                        <Button size="slim" onClick={() => runExportMutation.mutate({ id: r.id, format: 'pdf' })} loading={runExportMutation.isPending && runExportMutation.variables?.id === r.id && runExportMutation.variables?.format === 'pdf'}>PDF</Button>
                        <Button size="slim" onClick={() => runExportMutation.mutate({ id: r.id, format: 'xlsx' })} loading={runExportMutation.isPending && runExportMutation.variables?.id === r.id && runExportMutation.variables?.format === 'xlsx'}>Excel</Button>
                      </InlineStack>
                    )}
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Modal.Section>
      </Modal>
      {toast && <Toast content={toast} onDismiss={() => setToast(null)} duration={2500} />}
    </Page>
  );
}
