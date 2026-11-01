# 当前任务：MinerU 云端完善与 Agentic Vision 协同

用户要求在 codex/pdf-page-vision-wip-20261031 沿用现有实现，直接修改源码、真实复杂PDF和Agent测试，不改gold。2026-11-01再次核对：本地及GitHub分支基线均ff2304fb7853673393b5e69eec2fdcbc6db3b3b0，main为5fe1760。开发副本/tmp/xiaozhi-publish-20261031；该HEAD为恢复点，另有本机source-changes.tar.gz及原任务备份。

## 已完成的阶段实施

ZIP/路径/CRC/实际解压限额/SSRF与取消、完整原资产/来源绑定、结构化块和图片映射、父块chunks、合并表格、提交代际与图片hash、按需原页VL/partial/持久引用、跨轮恢复已接入现有上传/Repository/Agent；向量冷索引预检与四批并发修复已实测。原.env、内网服务和生产数据库未替换，云端仅限获许可公开PDF SHA白名单。

14组270项单测、26文件语法检查通过；六份真实PDF有成功云端资产，最初5/6和扫描重试均保留。真实财务上传→云端→Repository→Agent自动定位→FITZ→QwenVL→引用保存/追问恢复已验证；扫描件最新256.946秒、0次VL、正确补出原失败题核心事实，向量9.429秒返回30候选（原16.108秒预算失败）。聊天、合成Word、外用户隔离真实HTTP回归通过。

## 验收未全部通过

共同六题B5只有2/6核心答案匹配，含连接失败；财务颜色与gold分歧、海报VL失败、树图/phone连接失败保留。最新B6只是扫描件与phone两题定点2/2，不能拼成全套最佳成绩或宣称100题完成。普通文字延迟非退化尚未证明；全OCR/公式/表格内容精度、混合PDF同页部分缺失融合、真实版本更新/部分失败完整HTTP矩阵、旋转坐标与跨进程互斥、压力内存待验收。当前不可直接部署生产。

## 证据和下一步

报告：docs/PDF_PAGE_VISION_IMPLEMENTATION.md；详细真实结果：evidence/mineru-vision-20261101/REPORT.md、ab-run-summary.json、answer-adjudications.json及原始批次。原100题gold SHA一致，失败未覆盖。API源码与final6运行hash一致；其后只整理报告/统计脚本。

3183/3184隔离API已停止，数据库/文件保留；3080/api/config仍200。本轮用户已明确授权提交并推送；正在核对发布清单及远端状态。下一步优先解决模型连接稳定性与图例/小字核对，扩大固定独立重复样本，验证普通文字性能及版本更新恢复；不要把本轮限定验收当全部目标完成。
