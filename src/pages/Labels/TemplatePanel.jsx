import React from 'react';
import {
  Card, BlockStack, InlineStack, FormLayout, Select, TextField, Checkbox, Button, Text, RangeSlider, Badge, Divider,
} from '@shopify/polaris';
import NumberField from './NumberField.jsx';
import { BUILT_IN_PRESETS, CUSTOM_PRESET_KEY } from '../../utils/labels/presets.js';
import { setLabelDim, applyPreset } from '../../utils/labels/configEdit.js';
import { PRICE_SOURCE_LABELS } from '../../utils/labels/rows.js';

const ROTATIONS = [
  { label: '90° (Dymo/IDPRT roll, text reads upward)', value: '90' },
  { label: '0° (no rotation)', value: '0' },
  { label: '180°', value: '180' },
  { label: '270° (text reads downward)', value: '270' },
];

// Settings for one template. `cfg` is the draft being edited; nothing here talks to the server except
// through the callbacks (save/delete live in the page).
export default function TemplatePanel({
  cfg, setCfg, templates, selectedId, onSelectTemplate, templateName, setTemplateName,
  makeDefault, setMakeDefault, dirty, saving, onSave, onSaveAsNew, onDelete, onFitBarcode, fitMessage,
}) {
  const patch = (section, obj) => setCfg((c) => ({ ...c, [section]: { ...c[section], ...obj } }));
  const selected = templates.find((t) => t.id === selectedId) || null;

  const presetOptions = [
    ...BUILT_IN_PRESETS.map((p) => ({ label: p.name, value: p.key })),
    { label: 'Custom size', value: CUSTOM_PRESET_KEY },
  ];

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">Template</Text>
            {dirty && <Badge tone="attention">Unsaved changes</Badge>}
          </InlineStack>
          <Select
            label="Saved template"
            options={[{ label: 'None (built-in defaults)', value: '' }, ...templates.map((t) => ({ label: t.isDefault ? `${t.name} (default)` : t.name, value: t.id }))]}
            value={selectedId}
            onChange={onSelectTemplate}
          />
          <TextField label="Template name" value={templateName} onChange={setTemplateName} autoComplete="off" />
          <Checkbox label="Open the page with this template" checked={makeDefault} onChange={setMakeDefault} />
          <InlineStack gap="200">
            <Button variant="primary" onClick={onSave} loading={saving} disabled={!templateName.trim()}>
              {selected ? 'Save changes' : 'Save template'}
            </Button>
            {selected && <Button onClick={onSaveAsNew} disabled={saving || !templateName.trim() || templateName.trim() === selected.name}>Save as new</Button>}
            {selected && <Button tone="critical" onClick={onDelete} disabled={saving}>Delete</Button>}
          </InlineStack>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">Label size</Text>
          <Select
            label="Label type"
            options={presetOptions}
            value={cfg.presetKey || CUSTOM_PRESET_KEY}
            onChange={(key) => (key === CUSTOM_PRESET_KEY ? setCfg((c) => ({ ...c, presetKey: CUSTOM_PRESET_KEY })) : setCfg((c) => applyPreset(c, key)))}
          />
          <FormLayout.Group condensed>
            <NumberField label="Label width" suffix="mm" value={cfg.label.w} min={5} max={500} step={0.5}
              onChange={(v) => setCfg((c) => ({ ...setLabelDim(c, 'w', v), presetKey: CUSTOM_PRESET_KEY }))} />
            <NumberField label="Label height" suffix="mm" value={cfg.label.h} min={5} max={500} step={0.5}
              onChange={(v) => setCfg((c) => ({ ...setLabelDim(c, 'h', v), presetKey: CUSTOM_PRESET_KEY }))} />
          </FormLayout.Group>
          <Checkbox
            label="Lock proportions"
            helpText="Changing one side resizes the other, and everything on the label scales with it. Untick for a different shape (content is scaled to fit and centred)."
            checked={cfg.lockRatio}
            onChange={(v) => setCfg((c) => (v ? setLabelDim({ ...c, lockRatio: true }, 'w', c.label.w) : { ...c, lockRatio: false }))}
          />
          <Select label="Rotation" options={ROTATIONS} value={String(cfg.rotation)} onChange={(v) => setCfg((c) => ({ ...c, rotation: Number(v) }))} />
          <Select
            label="Page size (what the printer driver is set to)"
            options={[{ label: 'Same as label', value: 'label' }, { label: 'Custom page size', value: 'custom' }]}
            value={cfg.pageMode}
            onChange={(v) => setCfg((c) => ({ ...c, pageMode: v, page: v === 'custom' ? { ...(c.pageMode === 'custom' ? c.page : c.label) } : c.page }))}
          />
          {cfg.pageMode === 'custom' && (
            <FormLayout.Group condensed>
              <NumberField label="Page width" suffix="mm" value={cfg.page.w} min={5} max={500} step={0.1} onChange={(v) => patch('page', { w: v })} />
              <NumberField label="Page height" suffix="mm" value={cfg.page.h} min={5} max={500} step={0.1} onChange={(v) => patch('page', { h: v })} />
            </FormLayout.Group>
          )}
          <FormLayout.Group condensed>
            <NumberField label="Nudge across" suffix="mm" value={cfg.offset.x} min={-20} max={20} step={0.1} onChange={(v) => patch('offset', { x: v })} />
            <NumberField label="Nudge down" suffix="mm" value={cfg.offset.y} min={-20} max={20} step={0.1} onChange={(v) => patch('offset', { y: v })} />
          </FormLayout.Group>
          <Text as="p" tone="subdued" variant="bodySm">Nudge corrects a printer that prints slightly off-centre. Sizes below are for the label's original size and scale with it.</Text>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">Barcode</Text>
          <RangeSlider
            label="Barcode size"
            output
            min={20} max={200} step={5}
            value={Math.round(cfg.barcode.scale * 100)}
            suffix={<Text as="span">{Math.round(cfg.barcode.scale * 100)}%</Text>}
            onChange={(v) => patch('barcode', { scale: v / 100 })}
          />
          <InlineStack gap="200" blockAlign="center">
            <Button onClick={onFitBarcode}>Fit barcode</Button>
            {fitMessage && <Text as="span" tone="subdued" variant="bodySm">{fitMessage}</Text>}
          </InlineStack>
          <FormLayout.Group condensed>
            <NumberField label="Bar height" suffix="mm" value={cfg.barcode.heightMm} min={2} max={100} step={0.5} onChange={(v) => patch('barcode', { heightMm: v })} />
            <NumberField label="Bar width (module)" suffix="mm" value={cfg.barcode.moduleMm} min={0.05} max={2} step={0.025}
              helpText="Snapped to whole printer dots" onChange={(v) => patch('barcode', { moduleMm: v })} />
          </FormLayout.Group>
          <FormLayout.Group condensed>
            <NumberField label="Printer resolution" suffix="dpi" value={cfg.printerDpi} min={72} max={1200} step={1} onChange={(v) => setCfg((c) => ({ ...c, printerDpi: v }))} />
            <NumberField label="Quiet zone" suffix="bars" value={cfg.barcode.quietModules} min={0} max={20} step={1} onChange={(v) => patch('barcode', { quietModules: Math.round(v) })} />
          </FormLayout.Group>
          <Checkbox label="Print the barcode number under the bars" checked={cfg.number.on} onChange={(v) => patch('number', { on: v })} />
          {cfg.number.on && <NumberField label="Number size" suffix="pt" value={cfg.number.size} min={2} max={60} step={0.5} onChange={(v) => patch('number', { size: v })} />}
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">Text on the label</Text>
          <Checkbox label="Title" checked={cfg.title.on} onChange={(v) => patch('title', { on: v })} />
          {cfg.title.on && (
            <FormLayout>
              <Select label="Title shows" value={cfg.title.mode} onChange={(v) => patch('title', { mode: v })}
                options={[{ label: 'Product - Variant', value: 'combined' }, { label: 'Product title only', value: 'product' }, { label: 'Variant title only', value: 'variant' }]} />
              <FormLayout.Group condensed>
                <NumberField label="Size" suffix="pt" value={cfg.title.size} min={2} max={60} step={0.5} onChange={(v) => patch('title', { size: v, minSize: Math.min(cfg.title.minSize, v) })} />
                <NumberField label="Smallest size" suffix="pt" value={cfg.title.minSize} min={2} max={cfg.title.size} step={0.5} onChange={(v) => patch('title', { minSize: v })} />
                <NumberField label="Max lines" value={cfg.title.maxLines} min={1} max={6} step={1} onChange={(v) => patch('title', { maxLines: Math.round(v) })} />
              </FormLayout.Group>
              <Checkbox label="Bold" checked={cfg.title.bold} onChange={(v) => patch('title', { bold: v })} />
            </FormLayout>
          )}
          <Divider />
          <Checkbox label="Price" checked={cfg.price.on} onChange={(v) => patch('price', { on: v })} />
          {cfg.price.on && (
            <FormLayout>
              <Select label="Price comes from" value={cfg.price.source} onChange={(v) => patch('price', { source: v })}
                options={Object.entries(PRICE_SOURCE_LABELS).map(([value, label]) => ({ label, value }))} />
              <FormLayout.Group condensed>
                <TextField label="Prefix" value={cfg.price.prefix} onChange={(v) => patch('price', { prefix: v.slice(0, 8) })} autoComplete="off" />
                <NumberField label="Decimals" value={cfg.price.decimals} min={0} max={4} step={1} onChange={(v) => patch('price', { decimals: Math.round(v) })} />
                <NumberField label="Size" suffix="pt" value={cfg.price.size} min={2} max={60} step={0.5} onChange={(v) => patch('price', { size: v })} />
              </FormLayout.Group>
            </FormLayout>
          )}
          <Divider />
          <Checkbox label="SKU line" checked={cfg.sku.on} onChange={(v) => patch('sku', { on: v })} />
          {cfg.sku.on && <NumberField label="SKU size" suffix="pt" value={cfg.sku.size} min={2} max={60} step={0.5} onChange={(v) => patch('sku', { size: v })} />}
          <Checkbox label="Custom text line" checked={cfg.custom.on} onChange={(v) => patch('custom', { on: v })} />
          {cfg.custom.on && (
            <FormLayout.Group condensed>
              <TextField label="Text" value={cfg.custom.text} onChange={(v) => patch('custom', { text: v.slice(0, 80) })} autoComplete="off" />
              <NumberField label="Size" suffix="pt" value={cfg.custom.size} min={2} max={60} step={0.5} onChange={(v) => patch('custom', { size: v })} />
            </FormLayout.Group>
          )}
          <Divider />
          <FormLayout.Group condensed>
            <NumberField label="Padding" suffix="mm" value={cfg.padding} min={0} max={20} step={0.1} onChange={(v) => setCfg((c) => ({ ...c, padding: v }))} />
            <NumberField label="Line gap" suffix="mm" value={cfg.gap} min={0} max={20} step={0.1} onChange={(v) => setCfg((c) => ({ ...c, gap: v }))} />
          </FormLayout.Group>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
