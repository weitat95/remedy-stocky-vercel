import React, { useMemo, useState } from 'react';
import {
  Page, Card, Text, Button, Banner, Badge, DataTable, Spinner, TextField, Select, InlineStack, BlockStack, Tooltip, Icon,
} from '@shopify/polaris';
import { QuestionCircleIcon } from '@shopify/polaris-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { getVendors } from '../../api/vendors.js';
import { getLocations } from '../../api/inventory.js';
import { getSalesByVendor, exportSalesByVendor } from '../../api/consignment.js';

const rm = (n) => (n == null ? '—' : Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const errMsg = (err) => err.response?.data?.error || err.message;

// Default to the last completed month (store-local, UTC+8).
function lastMonth() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

const HeadTip = ({ label, tip }) => (
  <InlineStack gap="050" blockAlign="center" wrap={false}>
    <span>{label}</span>
    <Tooltip content={tip}><Icon source={QuestionCircleIcon} tone="subdued" /></Tooltip>
  </InlineStack>
);

export default function SalesByVendor() {
  const [vendorId, setVendorId] = useState('');
  const [month, setMonth] = useState(lastMonth());
  const [locationId, setLocationId] = useState('');
  const [error, setError] = useState(null);

  const { data: vendors = [] } = useQuery({ queryKey: ['vendors', 'all'], queryFn: () => getVendors({ includeHidden: true }) });
  const { data: locationsData } = useQuery({ queryKey: ['locations'], queryFn: getLocations });
  const locations = locationsData?.data || [];

  const params = { vendorId, month, locationId: locationId || undefined };
  const generate = useMutation({
    mutationFn: () => getSalesByVendor(params),
    onMutate: () => setError(null),
    onError: (err) => setError(errMsg(err)),
  });
  const download = useMutation({
    mutationFn: () => exportSalesByVendor(params),
    onSuccess: ({ blob, filename }) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    onError: (err) => setError(errMsg(err)),
  });
  const report = generate.data;
  const valid = !!vendorId && /^\d{4}-\d{2}$/.test(month);

  const rows = useMemo(() => {
    if (!report) return [];
    const bold = (v) => <Text as="span" fontWeight="semibold">{v}</Text>;
    const body = report.rows.map((r) => [
      r.variantTitle || '—', r.sku || '—', r.productTitle, report.vendor.name,
      rm(r.price), r.netItems, rm(r.netSales), rm(r.grossSales), rm(r.cogs),
      r.impliedMarginPct != null ? `${r.impliedMarginPct.toFixed(1)}%` : '—',
      r.hasRrp ? <>{rm(r.rrp)}{r.rrpDerived && <> <Badge tone="attention">from cost</Badge></>}</> : '—',
      r.hasRrp ? rm(r.payable) : '—', r.hasRrp ? rm(r.rrpNetSales) : '—', r.hasRrp ? rm(r.rrpGrossSales) : '—',
      r.hasRrp ? rm(r.costGap) : '—',
      !r.hasRrp ? <Badge tone="warning">No RRP</Badge> : r.costFlag ? <Badge tone="critical">Check cost / RRP</Badge> : '',
    ]);
    const t = report.totals;
    body.push([bold('TOTAL'), '', '', '', '', bold(t.netItems), bold(rm(t.netSales)), bold(rm(t.grossSales)), bold(rm(t.cogs)), '', '', bold(rm(t.payable)), bold(rm(t.rrpNetSales)), bold(rm(t.rrpGrossSales)), '', '']);
    return body;
  }, [report]);

  return (
    <Page fullWidth title="Sales by Vendor Monthly" subtitle="The client's monthly vendor sheet, regenerated from orders so it can be compared with the manual one">
      <BlockStack gap="400">
        <Card>
          <InlineStack gap="300" blockAlign="end" wrap>
            <div style={{ minWidth: 220 }}>
              <Select label="Vendor" value={vendorId} onChange={setVendorId}
                options={[{ label: 'Select a vendor…', value: '' }, ...vendors.map((v) => ({ label: v.name, value: v.id }))]} />
            </div>
            <div style={{ width: 160 }}>
              <TextField label="Month" type="month" value={month} onChange={setMonth} autoComplete="off" />
            </div>
            <div style={{ minWidth: 200 }}>
              <Select label="Location" value={locationId} onChange={setLocationId}
                options={[{ label: 'All locations', value: '' }, ...locations.map((l) => ({ label: l.name, value: l.id }))]} />
            </div>
            <Button variant="primary" onClick={() => generate.mutate()} loading={generate.isPending} disabled={!valid}>Generate</Button>
            <Button onClick={() => download.mutate()} loading={download.isPending} disabled={!valid || !report}>Download Excel</Button>
          </InlineStack>
        </Card>

        {error && <Banner tone="critical" title="This report can't be generated" onDismiss={() => setError(null)}>{error}</Banner>}
        {generate.isPending && <InlineStack align="center"><Spinner /></InlineStack>}

        {report && !generate.isPending && (
          <>
            {report.missingRrp.length > 0 && (
              <Banner tone="warning" title={`${report.missingRrp.length} variant(s) have no vendor RRP — their RRP columns are blank`}>
                <BlockStack gap="100">
                  {report.missingRrp.map((m) => (
                    <Text as="p" key={`${m.sku}-${m.productTitle}-${m.variantTitle}`}>
                      {m.sku || '(no SKU)'} — {m.productTitle}{m.variantTitle ? ` / ${m.variantTitle}` : ''}<Text as="span" tone="subdued"> · {m.reason}</Text>
                    </Text>
                  ))}
                </BlockStack>
              </Banner>
            )}
            {report.flaggedCount > 0 && (
              <Banner tone="critical" title={`${report.flaggedCount} variant(s) where Shopify cost × qty disagrees with the payable`}>
                <Text as="p">Usually a stale RRP or a stale Shopify cost. Tolerance: RM {report.tolerance.perUnit.toFixed(2)} per unit or {report.tolerance.ratio * 100}% of the payable, whichever is larger. Compared against the payable before promotions.</Text>
              </Banner>
            )}
            {report.warnings.length > 0 && <Banner tone="warning">{report.warnings.map((w) => <Text as="p" key={w}>{w}</Text>)}</Banner>}
            <Card>
              <BlockStack gap="100">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h3" variant="headingMd">{report.vendor.name} — {report.month} — {report.locationName}</Text>
                  {report.provisional && <Badge tone="attention">PROVISIONAL</Badge>}
                  {!report.period.complete && <Badge>Month to date</Badge>}
                </InlineStack>
                <Text as="p" tone="subdued">
                  Margin in force from {report.setting.effectiveFrom}: {report.setting.marginType === 'fixed'
                    ? `fixed ${report.setting.rate}${report.setting.valueType === 'percent' ? '%' : ' RM/unit'}`
                    : `tiered, band reached ${report.band.rate}${report.setting.valueType === 'percent' ? '%' : ' RM/unit'}`} · promo {report.setting.promoMode === 'include' ? 'included' : 'excluded'}.
                  Returned and removed units are excluded from every figure; figures come from orders, not Shopify Analytics, so small differences from a Shopify export are expected.
                </Text>
              </BlockStack>
            </Card>
            {report.rows.length === 0 ? (
              <Banner tone="info">No sales for this vendor in the month.</Banner>
            ) : (
              <Card padding="0">
                <DataTable
                  columnContentTypes={['text', 'text', 'text', 'text', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric', 'text']}
                  headings={[
                    'Variant', 'SKU', 'Product', 'Vendor', 'Store price', 'Net items', 'Net sales', 'Gross sales', 'Cost of goods sold', '%margin',
                    <HeadTip key="rrp" label="Vendor RRP" tip="The vendor's RRP (stored, or derived from cost when that fallback is on). Never the Shopify price." />,
                    <HeadTip key="cog" label="COG SOLD (payable)" tip="Amount payable to the vendor: RRP-based sales minus the store's margin from Vendor Margins." />,
                    'Net sales (RRP)', 'Gross sales (RRP)',
                    <HeadTip key="gap" label="Cost − payable" tip="Shopify unit cost × qty minus the payable before promotions. Non-zero beyond the tolerance means a stale RRP or cost." />,
                    'Check',
                  ]}
                  rows={rows}
                  hideScrollIndicator
                />
              </Card>
            )}
          </>
        )}
      </BlockStack>
    </Page>
  );
}
