const { buildRetrievalContext } = require('./DocumentRetrievalContext');
const { DocumentLexicalIndex } = require('./DocumentRetrieval');
const { DocumentArtifactRepository } = require('./DocumentArtifactRepository');
test('source headings augment lexical search without changing readable or exact-search text', async () => {
 const repo = new DocumentArtifactRepository({userId:'u',conversationId:'c',quality:{contextualRetrieval:true,queryProcessing:false,rerank:false}});
 const doc = repo.add({fileId:'f',records:[{page:1,text:'稀有设备的维护',title_level:1},{page:2,text:'每三个月检查一次。'}]});
 expect(doc.records[1].text).toBe('每三个月检查一次。');
 expect(doc.records[1].indexText).toBeUndefined();
 expect(doc.retrievalRecords[1].indexText).toContain('稀有设备');
 const hits = new DocumentLexicalIndex(doc.retrievalRecords).search('稀有设备').bm25;
 expect(hits.some(h=>h.record.chunkId===doc.records[1].chunkId)).toBe(true);
 const exact=await repo.executeAsync({action:'find_exact',query:'稀有设备',pages:[2]});
 expect(exact.match_count).toBe(0);
});
test('index keys change with version and source; internal headings do not rewrite earlier context', () => {
 const doc={sourceHash:'s1',bindingVersion:'b1',records:[{chunkId:'a',text:'before\n# later',parser_version:'p1'},{chunkId:'b',text:'next'}],headings:[{chunkId:'a',textOffset:7,title:'later',level:1}]};
 const a=buildRetrievalContext(doc);
 expect(a.records[0].retrievalContext.text).toBe(''); expect(a.records[1].retrievalContext.text).toBe('later');
 expect(buildRetrievalContext({...doc,sourceHash:'s2'}).key).not.toBe(a.key);
 expect(buildRetrievalContext(doc).key).toBe(a.key);
});
