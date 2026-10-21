import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Card, BlockStack, InlineStack, Text, Button, Banner, Badge, IndexTable, Checkbox, TextField,
} from '@shopify/polaris';
import { useMutation } from '@tanstack/react-query';
import { parseCSV, downloadCSVFile } from '../../utils/csv.js';
import { getProducts } from '../../api/products.js';
import { previewPriceSchedules, createPriceSchedules } from '../../api/priceSchedules.js';
import SkuMatchModal from '../../components/SkuMatchModal.jsx';
import ArchivedSkuModal from '../../components/ArchivedSkuModal.jsx';

// Header aliases, checked in order, first match wins (same convention as the other importers).
const ALIASES = {
  sku: ['sku'],
  start: ['start', 'start_at', 'start_time'],
  end: ['end', 'end_at', 'end_time'],
  price: ['price', 'new_price'],
  compareAtPrice: ['compare_at_price', 'compare_at', 'compareatprice'],
};
const pick = (row, keys) => {
  const k = keys.find((x) => x in row);
  return k ? (row[k] ?? '').trim() : '';
};

// Bounded concurrency, not Promise.all: the shared graphql() has no THROTTLED retry and a
// large file would otherwise fire one query per row at once.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const pad = (n) => String(n).padStart(2, '0');
// Example dates are generated relative to now (store-local = UTC+8) so the sample is valid when downloaded.
function exampleDate(daysAhead, hour) {
  const d = new Date(Date.now() + 8 * 3600_000 + daysAhead * 86400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(hour)}:00`;
}
export function downloadExample() {
  downloadCSVFile('price_schedule_example.csv', [
    ['sku', 'price', 'compare_at_price', 'start', 'end'],
    ['ABC-001', '40', '49', exampleDate(2, 9), exampleDate(5, 23)],
    ['ABC-002', '', 'clear', exampleDate(2, 9), exampleDate(5, 23)],
    ['ABC-003', '35.90', '', exampleDate(3, 0), ''],
  ]);
}

const money = (v) => (v == null ? '—' : v);

export default function Import({ onDone, onCancel, showToast }) {
  const fileInput = useRef(null);
  const [fileName, setFileName] = useState('');
  const [rawCsv, setRawCsv] = useState('');
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState(null); // merged client + server results
  const [writeAccess, setWriteAccess] = useState(null);
  const [ambiguous, setAmbiguous] = useState([]);
  const [ambiguousSelections, setAmbiguousSelections] = useState({});
  const [archivedSkus, setArchivedSkus] = useState([]);
  const pendingRef = useRef(null); // lookup results waiting on the ambiguous modal

  const [batchName, setBatchName] = useState('');
  const [ackLarge, setAckLarge] = useState(false);
  const [overrideHard, setOverrideHard] = useState(false);
  const [confirmCount, setConfirmCount] = useState('');

  // Lookups -> server preview. `lookups` is one entry per CSV row.
  const runPreview = useCallback(async (lookups) => {
    const sendable = lookups.filter((l) => l.shopifyVariantId && !l.clientError);
    let server = { rows: [], writeAccess: null };
    if (sendable.length) {
      server = await previewPriceSchedules(sendable.map((l) => ({
        rowId: l.rowId, shopifyVariantId: l.shopifyVariantId, sku: l.sku,
        price: l.price, compareAtPrice: l.compareAtPrice, start: l.start, end: l.end,
      })));
    }
    const byId = new Map(server.rows.map((r) => [r.rowId, r]));
    setWriteAccess(server.writeAccess);
    setRows(lookups.map((l) => {
      const s = byId.get(l.rowId);
      if (!s) {
        return { ...l, errors: [l.clientError || 'Not checked'], hardBlocks: [], flags: [], warnings: [] };
      }
      return { ...l, ...s, errors: s.errors, hardBlocks: s.hardBlocks, flags: s.flags, warnings: s.warnings };
    }));
  }, []);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setError(null);
    setRows(null);
    setParsing(true);
    setAckLarge(false); setOverrideHard(false); setConfirmCount('');
    try {
      const text = await file.text();
      const parsed = parseCSV(text);
      if (!parsed.length) { setError('CSV file is empty or has no data rows.'); return; }
      const first = parsed[0];
      const has = (k) => ALIASES[k].some((a) => a in first);
      if (!has('sku') || !has('start')) { setError('CSV must have "sku" and "start" columns.'); return; }
      if (!has('price') && !has('compareAtPrice')) { setError('CSV must have a "price" and/or "compare_at_price" column.'); return; }
      setFileName(file.name);
      setRawCsv(text);

      const lookups = await mapWithConcurrency(parsed, 8, async (row, i) => {
        const base = {
          rowId: String(i), line: i + 2, sku: pick(row, ALIASES.sku),
          price: pick(row, ALIASES.price), compareAtPrice: pick(row, ALIASES.compareAtPrice),
          start: pick(row, ALIASES.start), end: pick(row, ALIASES.end),
        };
        if (!base.sku) return { ...base, clientError: 'Missing SKU' };
        // Exact SKU match only: Shopify's sku: search tokenizes and returns lookalikes.
        const data = await getProducts({ search: base.sku, searchBy: 'sku', first: 10 });
        const matches = [];
        for (const product of data.products) {
          for (const variant of product.variants) if (variant.sku === base.sku) matches.push({ product, variant });
        }
        if (matches.length === 0) return { ...base, clientError: 'SKU not found' };
        if (matches.length > 1) return { ...base, kind: 'ambiguous', matches };
        const { product, variant } = matches[0];
        if (product.status === 'ARCHIVED') return { ...base, kind: 'archived', clientError: 'Archived product' };
        return { ...base, shopifyVariantId: variant.id };
      });

      const archived = lookups.filter((l) => l.kind === 'archived').map((l) => l.sku);
      if (archived.length) setArchivedSkus([...new Set(archived)]);
      const amb = lookups.filter((l) => l.kind === 'ambiguous');
      if (amb.length) {
        pendingRef.current = lookups;
        setAmbiguous(amb.map((l) => ({ id: l.rowId, sku: l.sku, matches: l.matches })));
        setAmbiguousSelections({});
        return; // the modal's handlers continue
      }
      await runPreview(lookups);
    } catch (err) {
      setError('Import failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setParsing(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }, [runPreview]);

  const finishAmbiguous = useCallback(async (resolve) => {
    const lookups = pendingRef.current.map((l) => {
      if (l.kind !== 'ambiguous') return l;
      const variantId = resolve ? ambiguousSelections[l.rowId] : null;
      const match = variantId && l.matches.find((m) => m.variant.id === variantId);
      if (!match) return { ...l, clientError: 'Ambiguous SKU: no match picked' };
      if (match.product.status === 'ARCHIVED') {
        setArchivedSkus((prev) => [...new Set([...prev, l.sku])]);
        return { ...l, clientError: 'Archived product' };
      }
      return { ...l, shopifyVariantId: match.variant.id };
    });
    pendingRef.current = null;
    setAmbiguous([]);
    setAmbiguousSelections({});
    setParsing(true);
    try { await runPreview(lookups); } catch (err) { setError('Preview failed: ' + (err.response?.data?.error || err.message)); } finally { setParsing(false); }
  }, [ambiguousSelections, runPreview]);

  const stats = useMemo(() => {
    if (!rows) return null;
    return {
      total: rows.length,
      errors: rows.filter((r) => r.errors.length).length,
      hard: rows.filter((r) => r.hardBlocks?.length).length,
      flagged: rows.filter((r) => r.flags?.length).length,
      permanent: rows.filter((r) => r.permanent).length,
      earliest: rows.map((r) => r.start).filter(Boolean).sort()[0],
      latestEnd: rows.map((r) => r.end).filter(Boolean).sort().slice(-1)[0],
    };
  }, [rows]);

  const needsTypedCount = stats && (stats.total > 25 || stats.permanent > 0);
  const canConfirm = stats && stats.errors === 0 &&
    (stats.hard === 0 || overrideHard) &&
    (stats.flagged === 0 || ackLarge) &&
    (!needsTypedCount || Number(confirmCount) === stats.total);

  const createMutation = useMutation({
    mutationFn: () => createPriceSchedules({
      rows: rows.map((r) => ({
        rowId: r.rowId, shopifyVariantId: r.shopifyVariantId, sku: r.sku,
        price: r.price, compareAtPrice: r.compareAtPrice, start: r.start, end: r.end,
      })),
      name: batchName, fileName, rawCsv,
      acknowledgeLarge: ackLarge, overrideHardBlocks: overrideHard, confirmCount: Number(confirmCount) || undefined,
    }),
    onSuccess: (res) => {
      showToast({ message: `Scheduled ${res.count} price change${res.count === 1 ? '' : 's'}` });
      onDone(res.batchId);
    },
    onError: (err) => setError(err.response?.data?.error || err.message),
  });

  const downloadErrorRows = () => {
    downloadCSVFile('price_schedule_errors.csv', [
      ['sku', 'price', 'compare_at_price', 'start', 'end', 'errors'],
      ...rows.filter((r) => r.errors.length).map((r) => [r.sku, r.price, r.compareAtPrice, r.start, r.end, r.errors.join('; ')]),
    ]);
  };

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">Upload CSV</Text>
          <Text tone="subdued">
            Required columns: <Text as="span" fontWeight="semibold">sku</Text>, <Text as="span" fontWeight="semibold">start</Text>, and
            {' '}<Text as="span" fontWeight="semibold">price</Text> and/or <Text as="span" fontWeight="semibold">compare_at_price</Text>.
            Optional: <Text as="span" fontWeight="semibold">end</Text> (blank = permanent change, never restored).
            Times are Kuala Lumpur time as <Text as="span" fontWeight="semibold">YYYY-MM-DD HH:mm</Text>. A blank price or compare-at leaves it unchanged;
            write <Text as="span" fontWeight="semibold">clear</Text> to empty the compare-at price. Nothing is saved until you confirm the preview.
          </Text>
          <InlineStack gap="200">
            <input
              ref={fileInput} type="file" accept=".csv,text/csv" style={{ display: 'none' }}
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <Button onClick={() => fileInput.current?.click()} loading={parsing}>{rows ? 'Choose a different file' : 'Choose CSV file'}</Button>
            <Button variant="plain" onClick={downloadExample}>Download example</Button>
            <Button variant="plain" onClick={onCancel}>Back to schedules</Button>
          </InlineStack>
          {parsing && <Text tone="subdued">Looking up SKUs and checking live prices…</Text>}
          {error && <Banner tone="critical" onDismiss={() => setError(null)}>{error}</Banner>}
        </BlockStack>
      </Card>

      {rows && stats && (
        <>
          {writeAccess === false && (
            <Banner tone="warning" title="Shopify write access not available yet">
              The app token doesn&apos;t carry <b>write_products</b>, so these changes would fail when they come due. Release the app version
              (<code>shopify app deploy</code>), approve &quot;Update access&quot; in Shopify Admin, and restart the backend before the first start time. You can still save.
            </Banner>
          )}
          <Card padding="0">
            <IndexTable
              selectable={false}
              resourceName={{ singular: 'row', plural: 'rows' }}
              itemCount={rows.length}
              headings={[
                { title: '#' }, { title: 'SKU' }, { title: 'Product' },
                { title: 'Current price', alignment: 'end' }, { title: 'Current compare-at', alignment: 'end' },
                { title: 'New price', alignment: 'end' }, { title: 'New compare-at', alignment: 'end' },
                { title: 'Start' }, { title: 'End' }, { title: 'Checks' },
              ]}
            >
              {rows.map((r, i) => (
                <IndexTable.Row id={r.rowId} key={r.rowId} position={i} tone={r.errors.length ? 'critical' : undefined}>
                  <IndexTable.Cell>{r.line}</IndexTable.Cell>
                  <IndexTable.Cell><Text fontWeight="semibold" as="span">{r.sku}</Text></IndexTable.Cell>
                  <IndexTable.Cell>{r.productTitle ? `${r.productTitle}${r.variantTitle && r.variantTitle !== 'Default Title' ? ` — ${r.variantTitle}` : ''}` : '—'}</IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" alignment="end">{money(r.currentPrice)}</Text></IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" alignment="end">{money(r.currentCompareAt)}</Text></IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" alignment="end">{r.newPrice ?? (r.price ? r.price : 'unchanged')}</Text></IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" alignment="end">{r.clearCompareAt ? 'clear' : r.newCompareAt ?? (r.compareAtPrice ? r.compareAtPrice : 'unchanged')}</Text></IndexTable.Cell>
                  <IndexTable.Cell>{r.start || '—'}</IndexTable.Cell>
                  <IndexTable.Cell>{r.end || <Badge tone="attention">Permanent</Badge>}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <BlockStack gap="100">
                      {r.errors.map((e) => <Text key={e} as="span" tone="critical">{e}</Text>)}
                      {(r.hardBlocks || []).map((e) => <Text key={e} as="span" tone="critical">Blocked: {e}</Text>)}
                      {(r.flags || []).map((e) => <Text key={e} as="span" tone="caution">Review: {e}</Text>)}
                      {(r.warnings || []).filter((w) => !w.startsWith('Permanent')).map((e) => <Text key={e} as="span" tone="caution">{e}</Text>)}
                      {!r.errors.length && !r.hardBlocks?.length && !r.flags?.length && !r.warnings?.filter((w) => !w.startsWith('Permanent')).length && <Text as="span" tone="success">OK</Text>}
                    </BlockStack>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Confirm</Text>
              <Text>
                {stats.total} row{stats.total === 1 ? '' : 's'} · first start {stats.earliest || '—'} · last end {stats.latestEnd || '—'} ·
                {' '}{stats.permanent} permanent · {stats.flagged} large change{stats.flagged === 1 ? '' : 's'} · {stats.errors} with errors
              </Text>
              {stats.errors > 0 && (
                <Banner tone="critical" title="Fix the errors to continue">
                  <BlockStack gap="200">
                    <Text>Uploads are all-or-nothing: nothing can be saved while any row has an error. Fix the CSV and upload it again.</Text>
                    <InlineStack><Button onClick={downloadErrorRows}>Download rows with errors</Button></InlineStack>
                  </BlockStack>
                </Banner>
              )}
              <TextField label="Batch note (optional)" value={batchName} onChange={setBatchName} autoComplete="off" placeholder="e.g. Raya promo, Brand X" />
              {stats.hard > 0 && (
                <Checkbox
                  label={`Override ${stats.hard} blocked row${stats.hard === 1 ? '' : 's'} (more than 90% off, or below cost)`}
                  checked={overrideHard} onChange={setOverrideHard}
                />
              )}
              {stats.flagged > 0 && (
                <Checkbox
                  label={`I've reviewed the ${stats.flagged} large price change${stats.flagged === 1 ? '' : 's'}`}
                  checked={ackLarge} onChange={setAckLarge}
                />
              )}
              {needsTypedCount && (
                <TextField
                  label={`Type ${stats.total} to confirm`}
                  helpText={stats.permanent > 0 ? `${stats.permanent} row(s) are permanent and will never be restored.` : 'Large upload.'}
                  value={confirmCount} onChange={setConfirmCount} autoComplete="off" inputMode="numeric"
                />
              )}
              <InlineStack gap="200">
                <Button variant="primary" disabled={!canConfirm} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
                  {`Schedule ${stats.total} change${stats.total === 1 ? '' : 's'}`}
                </Button>
                <Button onClick={onCancel}>Discard</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </>
      )}

      <SkuMatchModal
        open={ambiguous.length > 0}
        items={ambiguous.map((a) => ({
          id: a.id,
          sku: a.sku,
          options: a.matches.map((m) => ({
            label: `${m.product.title}${m.product.variants.length > 1 ? ` — ${m.variant.title}` : ''}${m.product.status === 'ARCHIVED' ? ' [Archived]' : ''}`,
            value: m.variant.id,
          })),
        }))}
        selections={ambiguousSelections}
        onSelect={(id, v) => setAmbiguousSelections((prev) => ({ ...prev, [id]: v }))}
        onConfirm={() => finishAmbiguous(true)}
        onCancel={() => finishAmbiguous(false)}
      />
      <ArchivedSkuModal open={archivedSkus.length > 0} skus={archivedSkus} onClose={() => setArchivedSkus([])} />
    </BlockStack>
  );
}
