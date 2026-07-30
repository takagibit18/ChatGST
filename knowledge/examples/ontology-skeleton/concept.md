# 育儿补贴知识 — concept.json

> 源文件：`data/concept.json`

```json
{
  "concepts": [
    {
      "id": "concept_a59613efb06e",
      "canonical_name": "Baby",
      "description": "资格判定对象:0-3周岁婴幼儿",
      "sources": [
        "resources/policy/base.md#Baby"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "parents": [],
      "supply": {
        "kind": "entity",
        "zh": "婴幼儿"
      }
    },
    {
      "id": "concept_5a38f9b532f2",
      "canonical_name": "Applicant",
      "description": "父母一方/其他监护人/儿童福利机构",
      "sources": [
        "resources/policy/base.md#Applicant"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "parents": [],
      "supply": {
        "kind": "entity",
        "zh": "申领人"
      }
    },
    {
      "id": "concept_4bdd767376a9",
      "canonical_name": "ChildOrder",
      "description": "同一对夫妻共同生育或合法收养并存活子女依次计算",
      "sources": [
        "resources/policy/base.md#ChildOrder"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "parents": [],
      "supply": {
        "kind": "enum",
        "zh": "孩次",
        "values": [
          "一孩",
          "二孩",
          "三孩",
          "三孩以上"
        ]
      }
    },
    {
      "id": "concept_1813015fc27c",
      "canonical_name": "ApplicantRole",
      "description": "申领人相对婴幼儿的身份(北京第五条/四川三:父母一方或其他监护人,含儿童福利机构)",
      "sources": [
        "resources/policy/base.md#ApplicantRole"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "parents": [],
      "supply": {
        "kind": "enum",
        "zh": "申领人身份",
        "values": [
          "生父母",
          "养父母",
          "有抚养权一方",
          "顺位监护人",
          "指定监护人",
          "儿童福利机构"
        ]
      }
    },
    {
      "id": "concept_c4531d3c4fc2",
      "canonical_name": "Number",
      "description": "月龄、金额、年份等,可参与算术比较",
      "sources": [
        "resources/policy/base.md#Number"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "parents": [],
      "supply": {
        "kind": "number",
        "zh": "数值"
      }
    },
    {
      "id": "concept_866619eb6b93",
      "canonical_name": "Bool",
      "description": "命题真/假",
      "sources": [
        "resources/policy/base.md#Bool"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "parents": [],
      "supply": {
        "kind": "bool",
        "zh": "布尔值"
      }
    },
    {
      "id": "concept_06dd1cf24d57",
      "canonical_name": "出生年份",
      "description": "婴幼儿的出生年份（四位数字）",
      "sources": [
        "resources/policy/base.md#出生年份"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "parents": [],
      "supply": {
        "kind": "number",
        "zh": "出生年份"
      }
    },
    {
      "id": "concept_2a17ec3a00b2",
      "canonical_name": "内蒙过渡期申请年度",
      "description": "内蒙古过渡期内允许申请的三个年份，针对2022-2024年出生的婴幼儿",
      "sources": [
        "resources/policy/base.md#内蒙过渡期申请年度"
      ],
      "created_at": "2026-07-16T16:14:12+08:00",
      "parents": [],
      "supply": {
        "kind": "enum",
        "zh": "内蒙过渡期申请年度",
        "values": [
          "2025年",
          "2026年",
          "2027年"
        ]
      }
    },
    {
      "id": "concept_130e24f1d493",
      "canonical_name": "内蒙过渡期类别",
      "description": "根据婴幼儿出生年份划分的过渡期类别，用于判断可申领次数和年份",
      "sources": [
        "resources/policy/base.md#内蒙过渡期类别"
      ],
      "created_at": "2026-07-16T16:14:12+08:00",
      "parents": [],
      "supply": {
        "kind": "enum",
        "zh": "内蒙过渡期类别",
        "values": [
          "2022年生",
          "2023年生",
          "2024年生",
          "非过渡期"
        ]
      }
    },
    {
      "id": "concept_127e67359e47",
      "canonical_name": "父母一方本市户籍",
      "description": "婴幼儿父母至少有一方具有呼和浩特市户籍",
      "sources": [
        "resources/policy/base.md#父母一方本市户籍"
      ],
      "created_at": "2026-07-16T16:14:13+08:00",
      "parents": [],
      "supply": {
        "kind": "bool",
        "zh": "父母一方本市户籍"
      }
    },
    {
      "id": "concept_4633d333bc39",
      "canonical_name": "人房户一致",
      "description": "婴幼儿家庭满足人、房、户一致，即夫妻一方户籍在本市、在本市居住工作生活、且拥有自有住房或医保缴费记录，且新生儿首次落户在本市",
      "sources": [
        "resources/policy/base.md#人房户一致"
      ],
      "created_at": "2026-07-16T16:14:13+08:00",
      "parents": [],
      "supply": {
        "kind": "bool",
        "zh": "人房户一致"
      }
    },
    {
      "id": "concept_90b75017fad5",
      "canonical_name": "新生儿首次落户本市",
      "description": "新生儿（婴幼儿）出生后首次户籍登记在呼和浩特市",
      "sources": [
        "resources/policy/base.md#新生儿首次落户本市"
      ],
      "created_at": "2026-07-16T16:14:13+08:00",
      "parents": [],
      "supply": {
        "kind": "bool",
        "zh": "新生儿首次落户本市"
      }
    },
    {
      "id": "concept_ba89d063fcdc",
      "canonical_name": "孕妇",
      "description": "孕期妇女，可申领孕检补贴",
      "sources": [
        "resources/policy/base.md#孕妇"
      ],
      "created_at": "2026-07-16T16:14:16+08:00",
      "parents": [],
      "supply": {
        "kind": "entity",
        "zh": "孕妇"
      }
    },
    {
      "id": "concept_1b890455f802",
      "canonical_name": "托育执业人员",
      "description": "在托育机构就业并取得相关证书的人员，可申领就业补贴",
      "sources": [
        "resources/policy/base.md#托育执业人员"
      ],
      "created_at": "2026-07-16T16:14:16+08:00",
      "parents": [],
      "supply": {
        "kind": "entity",
        "zh": "托育执业人员"
      }
    },
    {
      "id": "concept_0b657df86f82",
      "canonical_name": "学期",
      "description": "幼儿园或托育机构的学期",
      "sources": [
        "resources/policy/base.md#学期"
      ],
      "created_at": "2026-07-16T16:14:16+08:00",
      "parents": [],
      "supply": {
        "kind": "enum",
        "zh": "学期",
        "values": [
          "上学期",
          "下学期"
        ]
      }
    },
    {
      "id": "concept_1599de2c157c",
      "canonical_name": "孕周数",
      "description": "怀孕的周数（妊娠周数）",
      "sources": [
        "resources/policy/base.md#孕周数"
      ],
      "created_at": "2026-07-16T16:14:40+08:00",
      "parents": [],
      "supply": {
        "kind": "number",
        "zh": "孕周数"
      }
    },
    {
      "id": "concept_f207a9606710",
      "canonical_name": "出生日期",
      "description": "婴幼儿的出生日期，格式为YYYYMMDD数值，便于比较",
      "sources": [
        "resources/policy/base.md#出生日期"
      ],
      "created_at": "2026-07-16T16:14:43+08:00",
      "parents": [],
      "supply": {
        "kind": "number",
        "zh": "婴幼儿出生日期"
      }
    },
    {
      "id": "concept_daf941d73252",
      "canonical_name": "户籍迁入日期",
      "description": "婴幼儿户籍迁入本市的日期，格式为YYYYMMDD数值",
      "sources": [
        "resources/policy/base.md#户籍迁入日期"
      ],
      "created_at": "2026-07-16T16:14:43+08:00",
      "parents": [],
      "supply": {
        "kind": "number",
        "zh": "婴幼儿户籍迁入本市的日期"
      }
    },
    {
      "id": "concept_0f614715717c",
      "canonical_name": "核实已用工作日",
      "description": "审核确认过程中有疑问时，核实所耗用的工作日数",
      "sources": [
        "resources/policy/base.md#核实已用工作日"
      ],
      "created_at": "2026-07-16T16:14:45+08:00",
      "parents": [],
      "supply": {
        "kind": "number",
        "zh": "核实已用工作日"
      }
    },
    {
      "id": "concept_5d039746213c",
      "canonical_name": "夫妻一方本地户籍",
      "description": "婴幼儿父母至少一方具有本地（潜江）户籍",
      "sources": [
        "resources/policy/base.md#夫妻一方本地户籍"
      ],
      "created_at": "2026-07-16T16:14:50+08:00",
      "parents": [],
      "supply": {
        "kind": "bool",
        "zh": "夫妻一方本地户籍"
      }
    },
    {
      "id": "concept_66633871ca25",
      "canonical_name": "辅助生殖方式",
      "description": "辅助生殖技术的具体方式",
      "sources": [
        "resources/policy/base.md#辅助生殖方式"
      ],
      "created_at": "2026-07-16T16:14:51+08:00",
      "parents": [],
      "supply": {
        "kind": "enum",
        "zh": "辅助生殖方式",
        "values": [
          "人工授精",
          "试管婴儿"
        ]
      }
    },
    {
      "id": "concept_5c25c352b3e5",
      "canonical_name": "中国国籍",
      "description": "婴幼儿是否具有中华人民共和国国籍",
      "sources": [
        "resources/policy/base.md#中国国籍"
      ],
      "created_at": "2026-07-16T16:14:53+08:00",
      "parents": [],
      "supply": {
        "kind": "bool",
        "zh": "中国国籍"
      }
    },
    {
      "id": "concept_ea822137ecfe",
      "canonical_name": "线上申请渠道",
      "description": "贵州省育儿补贴线上申领的可选平台",
      "sources": [
        "resources/policy/base.md#线上申请渠道"
      ],
      "created_at": "2026-07-16T16:14:54+08:00",
      "parents": [],
      "supply": {
        "kind": "enum",
        "zh": "线上申请渠道",
        "values": [
          "多彩宝APP",
          "贵人服务支付宝小程序",
          "贵人服务微信小程序"
        ]
      }
    }
  ]
}

```
