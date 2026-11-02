# find_exact设计

最终真实Agent补测：search候选曾被误当全部原话匹配；增加search范围元数据与find_exact match_index。相同两轮r1/r2失败保留，r3自主find_exact limit2并使用原令牌返回1/2后3/4。见exact-agent-comparison.json。模型“全文56处”的措辞不等于OCR完整认证。
从当前授权Repository.records.text做字面或显式NFKC匹配，不搜索context或visual summary。limit/context_chars/page/chunk均有预算。返回原文slice、UTF16 start/end、真实页和chunk；规范化按grapheme映射，禁止在兼容展开片段内部伪造源片段。跨chunk只根据现存原始父块验证连续片段；相同页码或相邻顺序不能作为拼接依据，不把跨页拼接标单页。HMAC continuation绑定查询、范围、mode和源版本；结果保存reference可继续read。
rg只做受控stdin字面查询对照，不暴露shell/路径；部署未有rg时使用内存。以真实测试数据决定默认，不预设rg优势。

2026-11-02：字面默认，显式nfkc按完整grapheme映射源UTF16偏移。签名分页绑定原查询/模式/页范围/chunk/version。真实解析文本20次内存与rg命中数量相同，内存P50/P95为0.147/0.360ms，rg为28.542/34.314ms；这是宿主机测试且不含并发，不代表生产SLA。选择内存默认，无rg运行依赖。当时跨块精确匹配未实现，已被下述后续实现替代。

后续已补原始父块核验后的跨chunk匹配；未有父块的旧产物仍明确不支持跨块匹配，不猜顺序。测试cross-chunk-tests.json、output-budget-fixed.json。输出预算实现曾发生缺失括号，失败日志output-budget-tests.json保留；修正后29项通过。
