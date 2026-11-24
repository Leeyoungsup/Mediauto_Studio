export type AssayInput = {
  specimen_ref: string; histology: string; stain: string; clone: string; platform: string; protocol: string; region_ref: string;
};
export type ValidationEvidence = {
  reference: string; reviewed_by: string;
  reference_result: { value: number; counts: Record<string, number>; unit?: string };
};

export function BiomarkerEvidence({ input, evidence, schema, model, scope }: {
  input?: AssayInput | null; evidence?: ValidationEvidence | null; schema: string; model?: string; scope: string;
}) {
  return <details className="pdl1-audit"><summary>Result Contract and Validation</summary>
    <dl className="key-values">
      <div><dt>Output Schema</dt><dd>{schema}</dd></div>
      {model && <div><dt>Expected Model</dt><dd>{model}</dd></div>}
      <div><dt>Supported Scope</dt><dd>{scope}</dd></div>
      {input && <>
        <div><dt>Specimen Reference</dt><dd>{input.specimen_ref}</dd></div>
        <div><dt>Histology</dt><dd>{input.histology.replaceAll('_', ' ')}</dd></div>
        <div><dt>Stain and Clone</dt><dd>{input.stain} · {input.clone}</dd></div>
        <div><dt>Platform and Protocol</dt><dd>{input.platform} · {input.protocol}</dd></div>
        <div><dt>Analysis Region</dt><dd>{input.region_ref}</dd></div>
      </>}
      <div><dt>Validation Reference</dt><dd>{evidence?.reference ?? 'Reference Result Unverified'}</dd></div>
      {evidence && <>
        <div><dt>Reviewed By</dt><dd>{evidence.reviewed_by}</dd></div>
        <div><dt>Reference Result</dt><dd>{evidence.reference_result.value}{evidence.reference_result.unit === 'percent' ? '%' : ''}</dd></div>
      </>}
    </dl>
  </details>;
}
