const { compactDocumentResult } = require('./DocumentToolResult');
test('compact table preserves merged entity spans instead of treating expanded rows as independent entities',()=>{
 const result=compactDocumentResult({action:'read_table',content:'table',table:{rows:[['Entity','Values'],['A','1,2'],['A','3']],cells:[{row:1,column:0,rowspan:2,colspan:1,text:'A'},{row:1,column:1,rowspan:1,colspan:1,text:'1,2'}]}});
 expect(result.table.merged_cells).toEqual([{row:1,column:0,rowspan:2,colspan:1,text:'A'}]);expect(result.table.merge_semantics).toContain('SAME entity');expect(result.table.rows).toHaveLength(3);
});
