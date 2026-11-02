const { compactDocumentResult } = require('./DocumentToolResult');
test('compact table preserves merged entity spans instead of treating expanded rows as independent entities',()=>{
 const result=compactDocumentResult({action:'read_table',content:'table',table:{rows:[['Entity','Values'],['A','1,2'],['A','3']],cells:[{row:1,column:0,rowspan:2,colspan:1,text:'A'},{row:1,column:1,rowspan:1,colspan:1,text:'1,2'}]}});
 expect(result.table.merged_cells).toEqual([{row:1,column:0,rowspan:2,colspan:1,text:'A'}]);expect(result.table.merge_semantics).toContain('SAME entity');expect(result.table.rows).toHaveLength(3);
});
test('text and table delivery retain original source reference and coverage',()=>{
 const reference={document_id:'doc',source_hash:'sha',page_start:4,page_end:5,version:'v'};
 for(const table of [undefined,{rows:[['model','voltage'],['A','42 V']],cells:[]}]){
  const result=compactDocumentResult({action:table?'read_table':'read',content:'source',reference,page_coverage:[4,5],table});
  expect(result.reference).toEqual(reference);expect(result.page_coverage).toEqual([4,5]);
 }
});

test('exact lookup exposes original matches once and preserves signed continuation and reference', () => {
 const {compactDocumentResult}=require('./DocumentToolResult');
 const result={action:'find_exact',content:'original',hits:[{match_text:'original'}],matches:[{match_text:'original',source_offset:4}],continuation_token:'signed',reference:{chunk_id:'c'}};
 const projected=compactDocumentResult(result);
 expect(projected.content).toBeUndefined();expect(projected.hits).toBeUndefined();
 expect(projected.matches).toBe(result.matches);expect(projected.continuation_token).toBe('signed');expect(projected.reference).toBe(result.reference);
});
