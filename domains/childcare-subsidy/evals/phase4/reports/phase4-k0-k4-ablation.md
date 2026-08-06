# phase4-k0-k4-ablation

K0 因冻结原文未提交而不能重跑；K1–K4 使用独立索引真实改变知识输入。最终结论必须保留该阻断，不能把 manifest 当预测结果。

| id | status | repeats | deterministic | documents | chunks | doc_recall_5 | chunk_recall_5 | mrr_10 | ndcg_10 | region_leakage | temporal_leakage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| K0 | blocked_missing_frozen_source | 0 | false | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable |
| K1 | completed | 3 | true | 47 | 457 | 0.804348 | 0.804348 | 0.847826 | 0.722089 | 0.000000 | 0.000000 |
| K2 | completed | 3 | true | 41 | 449 | 0.891304 | 0.673913 | 0.758696 | 0.541958 | 0.000000 | 0.000000 |
| K3 | completed | 3 | true | 39 | 381 | 1.000000 | 0.891304 | 0.822464 | 0.673160 | 0.000000 | 0.000000 |
| K4 | completed | 3 | true | 39 | 381 | 1.000000 | 0.891304 | 0.822464 | 0.673160 | 0.000000 | 0.000000 |
