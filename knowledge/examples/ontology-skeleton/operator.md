# 育儿补贴知识 — operator.json

> 源文件：`data/operator.json`

```json
{
  "operators": [
    {
      "id": "operator_dbf6ab4cf8df",
      "canonical_name": "本市户籍",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "婴幼儿是否具有本市户籍",
      "sources": [
        "resources/policy/base.md#本市户籍"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "婴幼儿是否具有本市户籍",
        "hint": "用户必须明确说明婴幼儿具有本地户籍/本地籍(如“北京户籍”“攀枝花籍”),或在本地出生落户、父母均本地户籍,均视为 true"
      }
    },
    {
      "id": "operator_66ffa766f1be",
      "canonical_name": "本省户籍",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "婴幼儿是否具有本省户籍",
      "sources": [
        "resources/policy/base.md#本省户籍"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "婴幼儿是否具有本省户籍",
        "hint": "用户必须明确说明婴幼儿具有本地户籍/本地籍(如““四川的”),或在本地出生落户、父母均本地户籍,均视为 true"
      }
    },
    {
      "id": "operator_9c1f6363d53a",
      "canonical_name": "月龄",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "婴幼儿月龄(月)",
      "sources": [
        "resources/policy/base.md#月龄"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "婴幼儿月龄(月)",
        "hint": "“X个月”直接填X;“X岁”换算为月(X*12);“X岁半”=X*12+6"
      }
    },
    {
      "id": "operator_c67c45dd41f2",
      "canonical_name": "生效期内出生",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "出生日期在2025-1月-1日及以后",
      "sources": [
        "resources/policy/base.md#生效期内出生"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "出生日期在2025-1月-1日及以后",
        "hint": "出生日期在2025-01-01及以后填 true(如“2025年3月出生”);2025年前出生填 false"
      }
    },
    {
      "id": "operator_a4288eac3e42",
      "canonical_name": "合规生育",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "符合法律法规规定生育",
      "sources": [
        "resources/policy/base.md#合规生育"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "符合法律法规规定生育",
        "hint": "说‘符合规定’‘合法’等填true，否则false。"
      }
    },
    {
      "id": "operator_2f9fa0b50e3b",
      "canonical_name": "系收养",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "符合法律法规规定收养",
      "sources": [
        "resources/policy/base.md#系收养"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "符合法律法规规定收养",
        "hint": "说‘收养的’‘抱养的’等填true，否则false。"
      }
    },
    {
      "id": "operator_ae6a061906c8",
      "canonical_name": "系孤儿或事实无人抚养",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "孤儿或事实无人抚养婴幼儿",
      "sources": [
        "resources/policy/base.md#系孤儿或事实无人抚养"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "孤儿或事实无人抚养婴幼儿",
        "hint": "说‘孤儿’‘无人抚养’等填true，否则false。"
      }
    },
    {
      "id": "operator_26c3b1c37a85",
      "canonical_name": "孩次",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_4bdd767376a9",
      "description": "婴幼儿孩次",
      "sources": [
        "resources/policy/base.md#孩次"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "婴幼儿孩次",
        "hint": "说‘第一胎’→一孩，‘第二胎’→二孩，‘第三胎’→三孩，‘第四胎及以上’→三孩以上。"
      }
    },
    {
      "id": "operator_5164bfc7d93f",
      "canonical_name": "双胞胎或多胞胎",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "是否双胞胎/多胞胎",
      "sources": [
        "resources/policy/base.md#双胞胎或多胞胎"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "是否双胞胎/多胞胎",
        "hint": "说‘双胞胎’‘多胞胎’‘一次生两个’等填true，否则false。"
      }
    },
    {
      "id": "operator_a106d843ae5e",
      "canonical_name": "因子女死亡再生育",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "有子女死亡、存活不满三个,合规再生育的子女",
      "sources": [
        "resources/policy/base.md#因子女死亡再生育"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "有子女死亡、存活不满三个,合规再生育的子女",
        "hint": "说‘有子女死亡’‘孩子没了再生的’等填true，否则false。"
      }
    },
    {
      "id": "operator_5d01b64922f2",
      "canonical_name": "因子女残疾再生育",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "已育三孩、有子女经鉴定残疾,合规再生育的子女",
      "sources": [
        "resources/policy/base.md#因子女残疾再生育"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "已育三孩、有子女经鉴定残疾,合规再生育的子女",
        "hint": "说‘孩子残疾’‘鉴定残疾后生的’等填true，否则false。"
      }
    },
    {
      "id": "operator_c20d5cb8109e",
      "canonical_name": "民族自治地方合规生育",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "符合民族自治地方现行计生办法生育的子女",
      "sources": [
        "resources/policy/base.md#民族自治地方合规生育"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "符合民族自治地方现行计生办法生育的子女",
        "hint": "说‘民族地区政策’‘自治地方规定的’等填true，否则false。"
      }
    },
    {
      "id": "operator_5bae7f83e8ec",
      "canonical_name": "户籍迁入本市",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "3周岁以下婴幼儿户籍迁入本市",
      "sources": [
        "resources/policy/base.md#户籍迁入本市"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "3周岁以下婴幼儿户籍迁入本市",
        "hint": "说‘户口迁进’‘户籍迁入’等填true，否则false。"
      }
    },
    {
      "id": "operator_a5973de6d648",
      "canonical_name": "迁入当年已领迁出地补贴",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "迁入当年已在迁出地领取育儿补贴",
      "sources": [
        "resources/policy/base.md#迁入当年已领迁出地补贴"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "迁入当年已在迁出地领取育儿补贴",
        "hint": "说‘在原来地方领过’‘迁出地已发’等填true，否则false。"
      }
    },
    {
      "id": "operator_e59e58ce6a7e",
      "canonical_name": "户籍迁出本市",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "3周岁以下婴幼儿户籍迁出本市",
      "sources": [
        "resources/policy/base.md#户籍迁出本市"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "3周岁以下婴幼儿户籍迁出本市",
        "hint": "说‘户口迁出’‘户籍迁走’等填true，否则false。"
      }
    },
    {
      "id": "operator_ffd4da42fb72",
      "canonical_name": "迁出前已审核确认",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "户籍迁出日前已通过区卫健部门审核确认",
      "sources": [
        "resources/policy/base.md#迁出前已审核确认"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "户籍迁出日前已通过区卫健部门审核确认",
        "hint": "说‘迁出前已通过’‘审核确认过’等填true，否则false。"
      }
    },
    {
      "id": "operator_222203e7eabc",
      "canonical_name": "首次申请在出生当年或次年",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "在婴幼儿出生当年或次年提出首次申请",
      "sources": [
        "resources/policy/base.md#首次申请在出生当年或次年"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "在婴幼儿出生当年或次年提出首次申请",
        "hint": "说‘当年就申请’‘次年申请’等填true，否则false。"
      }
    },
    {
      "id": "operator_d07df35a0712",
      "canonical_name": "逾期未申请",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "逾期未在规定年度提交申请",
      "sources": [
        "resources/policy/base.md#逾期未申请"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "逾期未在规定年度提交申请",
        "hint": "说‘过期了’‘没在规定时间申请’等填true，否则false。"
      }
    },
    {
      "id": "operator_a8000f9be92e",
      "canonical_name": "申领人身份",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_1813015fc27c",
      "description": "申领人相对婴幼儿的身份",
      "sources": [
        "resources/policy/base.md#申领人身份"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "申领人相对婴幼儿的身份",
        "hint": "说‘亲生父母’→生父母，‘养父母’→养父母，‘有抚养权’→有抚养权一方，‘监护人顺序’→顺位监护人，‘指定监护人’→指定监护人，‘福利院’→儿童福利机构。"
      }
    },
    {
      "id": "operator_c863bc6cb42f",
      "canonical_name": "父母离异",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "婴幼儿父母离异",
      "sources": [
        "resources/policy/base.md#父母离异"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "婴幼儿父母离异",
        "hint": "说'离婚了'或'父母离异'填true，否则false。"
      }
    },
    {
      "id": "operator_e247e607146e",
      "canonical_name": "父母监护缺失",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "婴幼儿父母作为监护人缺失(父母死亡/丧失监护能力)",
      "sources": [
        "resources/policy/base.md#父母监护缺失"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "婴幼儿父母作为监护人缺失(父母死亡/丧失监护能力)",
        "hint": "说'父母去世/无监护能力'填true，否则false。"
      }
    },
    {
      "id": "operator_5d22dbe7a534",
      "canonical_name": "父母健在且有监护",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "父母健在且未丧失监护(一般情形,由父母领)",
      "sources": [
        "resources/policy/base.md#父母健在且有监护"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "父母健在且未丧失监护(一般情形,由父母领)",
        "hint": "默认true，说'父母不在了'或'无监护'填false。"
      }
    },
    {
      "id": "operator_315f7f933d91",
      "canonical_name": "系已死亡",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "婴幼儿已死亡",
      "sources": [
        "resources/policy/base.md#系已死亡"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "婴幼儿已死亡",
        "hint": "用户提到婴幼儿死亡/夭折/去世,填 true"
      }
    },
    {
      "id": "operator_8b4fea840d9c",
      "canonical_name": "死亡在生效期内",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "在2025-01-01及以后死亡(之前死亡不可申领)",
      "sources": [
        "resources/policy/base.md#死亡在生效期内"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "在2025-01-01及以后死亡(之前死亡不可申领)",
        "hint": "只要死亡发生在2025-01-01及以后就填 true;凡描述为近期/去年/今年/上个月夭折(即2025年及以后)均视为 true;仅当明确2025年前死亡才 false"
      }
    },
    {
      "id": "operator_3c2370fd3483",
      "canonical_name": "2025年前出生",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "2025-01-01以前出生(不满3周岁,补贴按月折算)",
      "sources": [
        "resources/policy/base.md#2025年前出生"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "2025-01-01以前出生(不满3周岁,补贴按月折算)",
        "hint": "出生日期在2025-01-01之前填 true(与“生效期内出生”互补)"
      }
    },
    {
      "id": "operator_9129f80b3b00",
      "canonical_name": "2025年6月后出生",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "2025-06-01及以后出生(攀枝花二三孩免社保提标口径)",
      "sources": [
        "resources/policy/base.md#2025年6月后出生"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "2025-06-01及以后出生(攀枝花二三孩免社保提标口径)",
        "hint": "出生日期在2025-06-01及以后填 true"
      }
    },
    {
      "id": "operator_2fd247782b66",
      "canonical_name": "夫妻双方均本地户籍",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "婴幼儿父母双方均为本地(攀枝花)户籍",
      "sources": [
        "resources/policy/base.md#夫妻双方均本地户籍"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "婴幼儿父母双方均为本地(攀枝花)户籍",
        "hint": "用户说“夫妻/父母双方都是本地户籍/攀枝花户籍”填 true"
      }
    },
    {
      "id": "operator_db16d0aba540",
      "canonical_name": "参加本市社保",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "父母参加本市(攀枝花)社会保险的城乡居民",
      "sources": [
        "resources/policy/base.md#参加本市社保"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "父母参加本市(攀枝花)社会保险的城乡居民",
        "hint": "用户说参加了本地社保填 true;说没参加填 false"
      }
    },
    {
      "id": "operator_3f94841dbfd4",
      "canonical_name": "低保或特困认定",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "经民政部门低保/特困人员认定",
      "sources": [
        "resources/policy/base.md#低保或特困认定"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "经民政部门低保/特困人员认定",
        "hint": "说'低保户'或'特困人员'填true，否则false。"
      }
    },
    {
      "id": "operator_3d2ac38a2b2f",
      "canonical_name": "脱贫或防返贫监测",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "经农业农村部门脱贫人口/防返贫监测对象认定",
      "sources": [
        "resources/policy/base.md#脱贫或防返贫监测"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "经农业农村部门脱贫人口/防返贫监测对象认定",
        "hint": "说'脱贫户'或'防返贫监测对象'填true，否则false。"
      }
    },
    {
      "id": "operator_4d9c17b997bb",
      "canonical_name": "现役军人家庭一方在本地",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "现役军人家庭,夫妻一方户籍在本地(攀枝花)",
      "sources": [
        "resources/policy/base.md#现役军人家庭一方在本地"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "现役军人家庭,夫妻一方户籍在本地(攀枝花)",
        "hint": "说'军属且一方户籍在本市'填true，否则false。"
      }
    },
    {
      "id": "operator_c9a9a415aa48",
      "canonical_name": "初审已用工作日",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "初审环节已耗用的工作日数",
      "sources": [
        "resources/policy/base.md#初审已用工作日"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "初审环节已耗用的工作日数",
        "hint": "直接填用户说的天数数值，如'用了3天'填3。"
      }
    },
    {
      "id": "operator_168fc2d17e41",
      "canonical_name": "审核确认已用工作日",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "审核确认环节已耗用的工作日数",
      "sources": [
        "resources/policy/base.md#审核确认已用工作日"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "审核确认环节已耗用的工作日数",
        "hint": "直接填用户说的天数数值，如'审核用了5天'填5。"
      }
    },
    {
      "id": "operator_8ad0f2030826",
      "canonical_name": "初审加审核已用工作日",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "初审+审核确认合计已耗用工作日(四川合并计时)",
      "sources": [
        "resources/policy/base.md#初审加审核已用工作日"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "初审+审核确认合计已耗用工作日(四川合并计时)",
        "hint": "填初审与审核天数之和，用户说'总共8天'填8。"
      }
    },
    {
      "id": "operator_c311f5614afe",
      "canonical_name": "信息无变动",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "续领年度内申领人/婴幼儿信息较上一年无变动",
      "sources": [
        "resources/policy/base.md#信息无变动"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "续领年度内申领人/婴幼儿信息较上一年无变动",
        "hint": "续领年度内申领人/婴幼儿信息较上一年无变动"
      }
    },
    {
      "id": "operator_b77c331b31d2",
      "canonical_name": "申领",
      "input_concepts": [
        "concept_5a38f9b532f2",
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "申领人为该婴幼儿申领育儿补贴",
      "sources": [
        "resources/policy/base.md#申领"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "relation",
        "zh": "申领人为该婴幼儿申领育儿补贴",
        "hint": "说'申请补贴'或'申领'填true，否则false。"
      }
    },
    {
      "id": "operator_124ea4c8ee51",
      "canonical_name": "身份为",
      "input_concepts": [
        "concept_1813015fc27c",
        "concept_1813015fc27c"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "申领人身份∈集合(引擎计算)",
      "sources": [
        "resources/policy/base.md#身份为"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "action",
        "zh": "申领人身份∈集合(引擎计算)"
      }
    },
    {
      "id": "operator_e6a3c4534439",
      "canonical_name": "大于",
      "input_concepts": [
        "concept_c4531d3c4fc2",
        "concept_c4531d3c4fc2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "数值比较 >(引擎实时计算)",
      "sources": [
        "resources/policy/base.md#大于"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "action",
        "zh": "数值比较 >(引擎实时计算)"
      }
    },
    {
      "id": "operator_5716cf8651a5",
      "canonical_name": "小于",
      "input_concepts": [
        "concept_c4531d3c4fc2",
        "concept_c4531d3c4fc2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "数值比较 <(引擎实时计算)",
      "sources": [
        "resources/policy/base.md#小于"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "action",
        "zh": "数值比较 <(引擎实时计算)"
      }
    },
    {
      "id": "operator_0816e6a8512e",
      "canonical_name": "属于",
      "input_concepts": [
        "concept_4bdd767376a9",
        "concept_4bdd767376a9"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "枚举取值∈集合(引擎计算)",
      "sources": [
        "resources/policy/base.md#属于"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "action",
        "zh": "枚举取值∈集合(引擎计算)"
      }
    },
    {
      "id": "operator_cb9e840b1df2",
      "canonical_name": "非",
      "input_concepts": [
        "concept_866619eb6b93"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "逻辑否定 ¬(引擎计算)",
      "sources": [
        "resources/policy/base.md#非"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "action",
        "zh": "逻辑否定 ¬(引擎计算)"
      }
    },
    {
      "id": "operator_6da5e33782da",
      "canonical_name": "属于补贴对象",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:属于育儿补贴对象",
      "sources": [
        "resources/policy/base.md#属于补贴对象"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:属于育儿补贴对象"
      }
    },
    {
      "id": "operator_a5bad2151bf5",
      "canonical_name": "可申领育儿补贴",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:可申领育儿补贴",
      "sources": [
        "resources/policy/base.md#可申领育儿补贴"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:可申领育儿补贴"
      }
    },
    {
      "id": "operator_e17b99979e19",
      "canonical_name": "补贴标准",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "结论:补贴标准(元/年)",
      "sources": [
        "resources/policy/base.md#补贴标准"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:补贴标准(元/年)"
      }
    },
    {
      "id": "operator_21c45fa4d959",
      "canonical_name": "免征个税",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:该补贴免征个人所得税",
      "sources": [
        "resources/policy/base.md#免征个税"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:该补贴免征个人所得税"
      }
    },
    {
      "id": "operator_b6becc5dadd1",
      "canonical_name": "不计入低保收入",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:低保/特困认定不计入收入",
      "sources": [
        "resources/policy/base.md#不计入低保收入"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:低保/特困认定不计入收入"
      }
    },
    {
      "id": "operator_b1408e51017e",
      "canonical_name": "可续领",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:可在后续年度续领",
      "sources": [
        "resources/policy/base.md#可续领"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:可在后续年度续领"
      }
    },
    {
      "id": "operator_5e62671e4467",
      "canonical_name": "不再发放",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:不再发放本市育儿补贴",
      "sources": [
        "resources/policy/base.md#不再发放"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:不再发放本市育儿补贴"
      }
    },
    {
      "id": "operator_ecb921610277",
      "canonical_name": "视为放弃",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:视为自动放弃当年申请资格",
      "sources": [
        "resources/policy/base.md#视为放弃"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:视为自动放弃当年申请资格"
      }
    },
    {
      "id": "operator_3bc0ccdfea0b",
      "canonical_name": "具备申领资格",
      "input_concepts": [
        "concept_5a38f9b532f2",
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:该申领人有资格为该婴幼儿申领",
      "sources": [
        "resources/policy/base.md#具备申领资格"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:该申领人有资格为该婴幼儿申领"
      }
    },
    {
      "id": "operator_a37c8d9a7c05",
      "canonical_name": "可申领死亡当年补贴",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:死亡婴幼儿可申领死亡当年补贴",
      "sources": [
        "resources/policy/base.md#可申领死亡当年补贴"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:死亡婴幼儿可申领死亡当年补贴"
      }
    },
    {
      "id": "operator_801c8bb53ef3",
      "canonical_name": "按月折算发放",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:2025年前出生不满3周岁,按应补贴月数折算计发(第十四条第2款)",
      "sources": [
        "resources/policy/base.md#按月折算发放"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:2025年前出生不满3周岁,按应补贴月数折算计发(第十四条第2款)"
      }
    },
    {
      "id": "operator_3daa1c2089de",
      "canonical_name": "发放迁出当年补贴",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:户籍迁出但迁出前已审核确认,仍发放当年补贴(第十五条第2款)",
      "sources": [
        "resources/policy/base.md#发放迁出当年补贴"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:户籍迁出但迁出前已审核确认,仍发放当年补贴(第十五条第2款)"
      }
    },
    {
      "id": "operator_e5f4305d2c27",
      "canonical_name": "不予补发",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:逾期的当年补贴不予补发",
      "sources": [
        "resources/policy/base.md#不予补发"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:逾期的当年补贴不予补发"
      }
    },
    {
      "id": "operator_1cc67ebca70b",
      "canonical_name": "线上申请",
      "input_concepts": [
        "concept_5a38f9b532f2",
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:可通过育儿补贴信息管理系统线上申请",
      "sources": [
        "resources/policy/base.md#线上申请"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:可通过育儿补贴信息管理系统线上申请"
      }
    },
    {
      "id": "operator_f9ef49e9acba",
      "canonical_name": "线下申请到户籍地",
      "input_concepts": [
        "concept_5a38f9b532f2",
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:可到婴幼儿户籍地乡镇政府(街道办)现场申请",
      "sources": [
        "resources/policy/base.md#线下申请到户籍地"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:可到婴幼儿户籍地乡镇政府(街道办)现场申请"
      }
    },
    {
      "id": "operator_582aa1369eaa",
      "canonical_name": "机构申请到登记地",
      "input_concepts": [
        "concept_5a38f9b532f2",
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:福利机构须到机构登记地乡镇政府(街道办)现场申请",
      "sources": [
        "resources/policy/base.md#机构申请到登记地"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:福利机构须到机构登记地乡镇政府(街道办)现场申请"
      }
    },
    {
      "id": "operator_8703732c5df2",
      "canonical_name": "按年一次性发放",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:育儿补贴按年计算,每年一次性发放",
      "sources": [
        "resources/policy/base.md#按年一次性发放"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:育儿补贴按年计算,每年一次性发放"
      }
    },
    {
      "id": "operator_9380648b8950",
      "canonical_name": "季度第2月初发放",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:每季度第2个月初向上季度已审核确认对象发放(四川五(一))",
      "sources": [
        "resources/policy/base.md#季度第2月初发放"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:每季度第2个月初向上季度已审核确认对象发放(四川五(一))"
      }
    },
    {
      "id": "operator_a4f35411c228",
      "canonical_name": "发放至社保卡或银行卡",
      "input_concepts": [
        "concept_5a38f9b532f2",
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:通过一卡通发放至申领人或婴幼儿社保卡/银行卡(个人申领人)",
      "sources": [
        "resources/policy/base.md#发放至社保卡或银行卡"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:通过一卡通发放至申领人或婴幼儿社保卡/银行卡(个人申领人)"
      }
    },
    {
      "id": "operator_87f711d62a74",
      "canonical_name": "发放至机构对公账户",
      "input_concepts": [
        "concept_5a38f9b532f2",
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:福利机构申领,由县级卫健按国库集中支付发放至机构对公账户",
      "sources": [
        "resources/policy/base.md#发放至机构对公账户"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:福利机构申领,由县级卫健按国库集中支付发放至机构对公账户"
      }
    },
    {
      "id": "operator_5c5c9b85377f",
      "canonical_name": "满足提标条件",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论(中间):二三孩满足攀枝花提标条件(6000元)",
      "sources": [
        "resources/policy/base.md#满足提标条件"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论(中间):二三孩满足攀枝花提标条件(6000元)"
      }
    },
    {
      "id": "operator_49df9b44c6b5",
      "canonical_name": "执行提标标准",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "结论:执行攀枝花提标标准6000元/年(与国标就高,不叠加)",
      "sources": [
        "resources/policy/base.md#执行提标标准"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:执行攀枝花提标标准6000元/年(与国标就高,不叠加)"
      }
    },
    {
      "id": "operator_dd244cade5b7",
      "canonical_name": "执行国家标准",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "结论:执行国家基础标准3600元/年",
      "sources": [
        "resources/policy/base.md#执行国家标准"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:执行国家基础标准3600元/年"
      }
    },
    {
      "id": "operator_bdf0456afd8b",
      "canonical_name": "应由父母领",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:一般情形,由父母一方申领",
      "sources": [
        "resources/policy/base.md#应由父母领"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:一般情形,由父母一方申领"
      }
    },
    {
      "id": "operator_0d56f49ce6cd",
      "canonical_name": "应由有抚养权方领",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:父母离异,由有抚养权一方申领",
      "sources": [
        "resources/policy/base.md#应由有抚养权方领"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:父母离异,由有抚养权一方申领"
      }
    },
    {
      "id": "operator_bc709f506d2a",
      "canonical_name": "应由其他监护人领",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:父母监护缺失,由顺位/指定监护人申领",
      "sources": [
        "resources/policy/base.md#应由其他监护人领"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:父母监护缺失,由顺位/指定监护人申领"
      }
    },
    {
      "id": "operator_1104756d65b1",
      "canonical_name": "应由福利机构领",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:孤儿/事实无人抚养,由儿童福利机构申领",
      "sources": [
        "resources/policy/base.md#应由福利机构领"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:孤儿/事实无人抚养,由儿童福利机构申领"
      }
    },
    {
      "id": "operator_5441faa02928",
      "canonical_name": "到户籍地办理",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:到婴幼儿户籍地乡镇政府(街道办)办理(个人申领人)",
      "sources": [
        "resources/policy/base.md#到户籍地办理"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:到婴幼儿户籍地乡镇政府(街道办)办理(个人申领人)"
      }
    },
    {
      "id": "operator_6b5eb8e76104",
      "canonical_name": "到机构登记地办理",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:到机构登记所在地乡镇政府(街道办)办理(福利机构)",
      "sources": [
        "resources/policy/base.md#到机构登记地办理"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:到机构登记所在地乡镇政府(街道办)办理(福利机构)"
      }
    },
    {
      "id": "operator_09af2c5db6fa",
      "canonical_name": "初审超期",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:初审超过法定时限(北京15工作日)",
      "sources": [
        "resources/policy/base.md#初审超期"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:初审超过法定时限(北京15工作日)"
      }
    },
    {
      "id": "operator_7286dab9153c",
      "canonical_name": "审核确认超期",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:审核确认超过法定时限(北京10工作日)",
      "sources": [
        "resources/policy/base.md#审核确认超期"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:审核确认超过法定时限(北京10工作日)"
      }
    },
    {
      "id": "operator_7008980b1c17",
      "canonical_name": "办理超期",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:初审+审核合计超过法定时限(四川30工作日)",
      "sources": [
        "resources/policy/base.md#办理超期"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:初审+审核合计超过法定时限(四川30工作日)"
      }
    },
    {
      "id": "operator_e2fb29f45e4e",
      "canonical_name": "可简化续领",
      "input_concepts": [
        "concept_5a38f9b532f2",
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:续领可走简化流程,仅线上/线下确认即可,无需重复提交材料(河北)",
      "sources": [
        "resources/policy/base.md#可简化续领"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:续领可走简化流程,仅线上/线下确认即可,无需重复提交材料(河北)"
      }
    },
    {
      "id": "operator_aa41f9283f05",
      "canonical_name": "出生年份",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_06dd1cf24d57",
      "description": "获取婴幼儿的出生年份",
      "sources": [
        "resources/policy/base.md#出生年份"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "attr",
        "zh": "获取婴幼儿的出生年份",
        "hint": "说'孩子是XXXX年出生'，填四位数字年份。"
      }
    },
    {
      "id": "operator_9be83c74425d",
      "canonical_name": "月补贴标准",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "福建省2025年1月1日前出生婴幼儿按月折算的月补贴标准，每孩每月300元",
      "sources": [
        "resources/policy/base.md#月补贴标准"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "福建省2025年1月1日前出生婴幼儿按月折算的月补贴标准，每孩每月300元"
      }
    },
    {
      "id": "operator_1ccff7813008",
      "canonical_name": "乡镇初审超期",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "乡镇初审超过20工作日的结论（福建）",
      "sources": [
        "resources/policy/base.md#乡镇初审超期"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "乡镇初审超过20工作日的结论（福建）"
      }
    },
    {
      "id": "operator_e2897bc7f8da",
      "canonical_name": "季度末集中发放",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "补贴在每年的3月、6月、9月、12月向上一季度审核通过的申领人集中发放（福建）",
      "sources": [
        "resources/policy/base.md#季度末集中发放"
      ],
      "created_at": "2026-07-14T20:32:28+08:00",
      "supply": {
        "kind": "output",
        "zh": "补贴在每年的3月、6月、9月、12月向上一季度审核通过的申领人集中发放（福建）"
      }
    },
    {
      "id": "operator_011d3b877b37",
      "canonical_name": "户籍迁出前已提交申请",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "婴幼儿户籍迁出前，其申领人已提交育儿补贴申请",
      "sources": [
        "resources/policy/base.md#户籍迁出前已提交申请"
      ],
      "created_at": "2026-07-16T16:14:08+08:00",
      "supply": {
        "kind": "attr",
        "zh": "婴幼儿户籍迁出前，其申领人已提交育儿补贴申请",
        "hint": "说'迁户口前已申请'填true，否则false。"
      }
    },
    {
      "id": "operator_ff8b76d30a2e",
      "canonical_name": "每季度集中发放",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "补贴每季度集中发放一次",
      "sources": [
        "resources/policy/base.md#每季度集中发放"
      ],
      "created_at": "2026-07-16T16:14:08+08:00",
      "supply": {
        "kind": "output",
        "zh": "补贴每季度集中发放一次"
      }
    },
    {
      "id": "operator_c9883adb7036",
      "canonical_name": "首次申请在2025年",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "申领人在2025年提出首次申请",
      "sources": [
        "resources/policy/base.md#首次申请在2025年"
      ],
      "created_at": "2026-07-16T16:14:08+08:00",
      "supply": {
        "kind": "attr",
        "zh": "申领人在2025年提出首次申请",
        "hint": "说'2025年第一次申请'填true，否则false。"
      }
    },
    {
      "id": "operator_554862613054",
      "canonical_name": "内蒙过渡期类别判定",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_130e24f1d493",
      "description": "根据婴幼儿出生年份判定其属于哪个内蒙过渡期类别",
      "sources": [
        "resources/policy/base.md#内蒙过渡期类别判定"
      ],
      "created_at": "2026-07-16T16:14:12+08:00",
      "supply": {
        "kind": "attr",
        "zh": "根据婴幼儿出生年份判定其属于哪个内蒙过渡期类别",
        "hint": "出生年份为2022年则输出'2022年生'，2023年则'2023年生'，2024年则'2024年生'，其他则'非过渡期'"
      }
    },
    {
      "id": "operator_a1f32aec2b5d",
      "canonical_name": "内蒙过渡期可申领总次数",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "返回该婴幼儿在内蒙古过渡期内可申领育儿补贴的总次数（包括首次和续领）",
      "sources": [
        "resources/policy/base.md#内蒙过渡期可申领总次数"
      ],
      "created_at": "2026-07-16T16:14:12+08:00",
      "supply": {
        "kind": "attr",
        "zh": "返回该婴幼儿在内蒙古过渡期内可申领育儿补贴的总次数（包括首次和续领）",
        "hint": "2022年生为1次，2023年生为2次，2024年生为3次，非过渡期不适用"
      }
    },
    {
      "id": "operator_1add08673e00",
      "canonical_name": "在过渡期年度内可申领",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "判断该婴幼儿是否允许在指定的过渡期年度内申请育儿补贴",
      "sources": [
        "resources/policy/base.md#在过渡期年度内可申领"
      ],
      "created_at": "2026-07-16T16:14:12+08:00",
      "supply": {
        "kind": "attr",
        "zh": "判断该婴幼儿是否允许在指定的过渡期年度内申请育儿补贴",
        "hint": "2022年生仅可在2025年申请；2023年生可在2025和2026年申请；2024年生可在2025、2026、2027年申请"
      }
    },
    {
      "id": "operator_b718d9a7c54e",
      "canonical_name": "父母一方本市户籍",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "婴幼儿父母至少一方有本市户籍",
      "sources": [
        "resources/policy/base.md#父母一方本市户籍"
      ],
      "created_at": "2026-07-16T16:14:13+08:00",
      "supply": {
        "kind": "attr",
        "zh": "婴幼儿父母至少一方有本市户籍",
        "hint": "说'爸爸/妈妈是本地户口'填true，否则false。"
      }
    },
    {
      "id": "operator_30c032985cde",
      "canonical_name": "人房户一致",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "婴幼儿家庭人房户一致",
      "sources": [
        "resources/policy/base.md#人房户一致"
      ],
      "created_at": "2026-07-16T16:14:13+08:00",
      "supply": {
        "kind": "attr",
        "zh": "婴幼儿家庭人房户一致",
        "hint": "说'人房户一致'或'实际居住与户口一致'填true，否则false。"
      }
    },
    {
      "id": "operator_c15a6cab0366",
      "canonical_name": "新生儿首次落户本市",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "新生儿首次落户在本市",
      "sources": [
        "resources/policy/base.md#新生儿首次落户本市"
      ],
      "created_at": "2026-07-16T16:14:13+08:00",
      "supply": {
        "kind": "attr",
        "zh": "新生儿首次落户在本市",
        "hint": "说“孩子户口落在本市”为true，否则false。"
      }
    },
    {
      "id": "operator_cbea9afba152",
      "canonical_name": "一次性发放",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "育儿补贴一次性发放（如呼和浩特一孩）",
      "sources": [
        "resources/policy/base.md#一次性发放"
      ],
      "created_at": "2026-07-16T16:14:13+08:00",
      "supply": {
        "kind": "output",
        "zh": "育儿补贴一次性发放（如呼和浩特一孩）"
      }
    },
    {
      "id": "operator_71683956ebe4",
      "canonical_name": "分年发放年数",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "育儿补贴分年度发放的总年数（如二孩5年，三孩10年）",
      "sources": [
        "resources/policy/base.md#分年发放年数"
      ],
      "created_at": "2026-07-16T16:14:13+08:00",
      "supply": {
        "kind": "output",
        "zh": "育儿补贴分年度发放的总年数（如二孩5年，三孩10年）"
      }
    },
    {
      "id": "operator_44c3d9cc2f40",
      "canonical_name": "每年两次发放",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "育儿补贴每年分两次（7月和1月）发放",
      "sources": [
        "resources/policy/base.md#每年两次发放"
      ],
      "created_at": "2026-07-16T16:14:13+08:00",
      "supply": {
        "kind": "output",
        "zh": "育儿补贴每年分两次（7月和1月）发放"
      }
    },
    {
      "id": "operator_c6a455dc6506",
      "canonical_name": "免申即享资格确认",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "通过免申即享自动化审核确认资格",
      "sources": [
        "resources/policy/base.md#免申即享资格确认"
      ],
      "created_at": "2026-07-16T16:14:13+08:00",
      "supply": {
        "kind": "output",
        "zh": "通过免申即享自动化审核确认资格"
      }
    },
    {
      "id": "operator_26cf3b46bcca",
      "canonical_name": "需年审",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "后续年度需年审（提交确认）",
      "sources": [
        "resources/policy/base.md#需年审"
      ],
      "created_at": "2026-07-16T16:14:13+08:00",
      "supply": {
        "kind": "output",
        "zh": "后续年度需年审（提交确认）"
      }
    },
    {
      "id": "operator_c4da8bc3fd9e",
      "canonical_name": "夫妻一方本地户籍",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "婴幼儿父母至少一方为鄂尔多斯市户籍",
      "sources": [
        "resources/policy/base.md#夫妻一方本地户籍"
      ],
      "created_at": "2026-07-16T16:14:16+08:00",
      "supply": {
        "kind": "attr",
        "zh": "婴幼儿父母至少一方为鄂尔多斯市户籍",
        "hint": "说“一方是本地户口”为true，否则false。"
      }
    },
    {
      "id": "operator_35b3194a373a",
      "canonical_name": "夫妻一方为现役军人或消防救援且居住本地",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "夫妻一方为现役军人或消防救援人员，且居住在鄂尔多斯的市外户籍家庭",
      "sources": [
        "resources/policy/base.md#夫妻一方为现役军人或消防救援且居住本地"
      ],
      "created_at": "2026-07-16T16:14:16+08:00",
      "supply": {
        "kind": "attr",
        "zh": "夫妻一方为现役军人或消防救援人员，且居住在鄂尔多斯的市外户籍家庭",
        "hint": "说“一方是军人/消防员且住本市”为true，否则false。"
      }
    },
    {
      "id": "operator_0922e2d15d2b",
      "canonical_name": "在鄂尔多斯政策生效后出生",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "出生日期在2023年11月22日及以后",
      "sources": [
        "resources/policy/base.md#在鄂尔多斯政策生效后出生"
      ],
      "created_at": "2026-07-16T16:14:16+08:00",
      "supply": {
        "kind": "attr",
        "zh": "出生日期在2023年11月22日及以后",
        "hint": "说“出生日期在2023年11月22日后”为true，否则false。"
      }
    },
    {
      "id": "operator_8eff035253f0",
      "canonical_name": "处于孕期",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "申领人处于孕期",
      "sources": [
        "resources/policy/base.md#处于孕期"
      ],
      "created_at": "2026-07-16T16:14:16+08:00",
      "supply": {
        "kind": "attr",
        "zh": "申领人处于孕期",
        "hint": "说“正在怀孕”为true，否则false。"
      }
    },
    {
      "id": "operator_4a2570a83432",
      "canonical_name": "孕检费用超过500",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "孕期检查费超过500元",
      "sources": [
        "resources/policy/base.md#孕检费用超过500"
      ],
      "created_at": "2026-07-16T16:14:16+08:00",
      "supply": {
        "kind": "attr",
        "zh": "孕期检查费超过500元",
        "hint": "说“孕检花费超500元”为true，否则false。"
      }
    },
    {
      "id": "operator_ef23456a7a86",
      "canonical_name": "入托或入园状态",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "婴幼儿在托育机构或幼儿园就读",
      "sources": [
        "resources/policy/base.md#入托或入园状态"
      ],
      "created_at": "2026-07-16T16:14:16+08:00",
      "supply": {
        "kind": "attr",
        "zh": "婴幼儿在托育机构或幼儿园就读",
        "hint": "说“孩子在托班或幼儿园”为true，否则false。"
      }
    },
    {
      "id": "operator_a32321702a2f",
      "canonical_name": "实际抚养人",
      "input_concepts": [
        "concept_5a38f9b532f2",
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "申领人是否实际承担抚养责任并实际照料婴幼儿",
      "sources": [
        "resources/policy/base.md#实际抚养人"
      ],
      "created_at": "2026-07-16T16:14:16+08:00",
      "supply": {
        "kind": "attr",
        "zh": "申领人是否实际承担抚养责任并实际照料婴幼儿",
        "hint": "说“实际抚养并照料孩子”为true，否则false。"
      }
    },
    {
      "id": "operator_688592846fd0",
      "canonical_name": "抚养份额",
      "input_concepts": [
        "concept_5a38f9b532f2",
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "抚养比例，0到1之间，用于离异双方各50%的情况",
      "sources": [
        "resources/policy/base.md#抚养份额"
      ],
      "created_at": "2026-07-16T16:14:16+08:00",
      "supply": {
        "kind": "attr",
        "zh": "抚养比例，0到1之间，用于离异双方各50%的情况",
        "hint": "说“抚养比例50%”填0.5，按实际比例换算0-1。"
      }
    },
    {
      "id": "operator_c2ab9f68a357",
      "canonical_name": "托育执业人员就业",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "申领人在托育机构就业",
      "sources": [
        "resources/policy/base.md#托育执业人员就业"
      ],
      "created_at": "2026-07-16T16:14:16+08:00",
      "supply": {
        "kind": "attr",
        "zh": "申领人在托育机构就业",
        "hint": "说“在托育机构工作”为true，否则false。"
      }
    },
    {
      "id": "operator_bd59faa82c9e",
      "canonical_name": "取得相关证书",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "参加培训并取得职业资格证书或职业技能等级证书等",
      "sources": [
        "resources/policy/base.md#取得相关证书"
      ],
      "created_at": "2026-07-16T16:14:16+08:00",
      "supply": {
        "kind": "attr",
        "zh": "参加培训并取得职业资格证书或职业技能等级证书等",
        "hint": "说“取得了职业资格证书”为true，否则false。"
      }
    },
    {
      "id": "operator_e3e158d78cab",
      "canonical_name": "就业满一年内申报",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "在就业满1年内申报，否则不予追加",
      "sources": [
        "resources/policy/base.md#就业满一年内申报"
      ],
      "created_at": "2026-07-16T16:14:16+08:00",
      "supply": {
        "kind": "output",
        "zh": "在就业满1年内申报，否则不予追加"
      }
    },
    {
      "id": "operator_f33aaadcc7f4",
      "canonical_name": "出生后两年内未申请",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "孩子出生后满2年内未主动申请",
      "sources": [
        "resources/policy/base.md#出生后两年内未申请"
      ],
      "created_at": "2026-07-16T16:14:16+08:00",
      "supply": {
        "kind": "attr",
        "zh": "孩子出生后满2年内未主动申请",
        "hint": "说“孩子出生超两年没申请”为true，否则false。"
      }
    },
    {
      "id": "operator_e315553220aa",
      "canonical_name": "年度补贴金额",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "每年发放的育儿补贴金额（二孩每年3000，三孩每年10000）",
      "sources": [
        "resources/policy/base.md#年度补贴金额"
      ],
      "created_at": "2026-07-16T16:14:16+08:00",
      "supply": {
        "kind": "output",
        "zh": "每年发放的育儿补贴金额（二孩每年3000，三孩每年10000）"
      }
    },
    {
      "id": "operator_b46963f527d4",
      "canonical_name": "学期补贴金额",
      "input_concepts": [
        "concept_a59613efb06e",
        "concept_0b657df86f82"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "每学期的入托入园补贴金额（二孩每学期1000，三孩2500）",
      "sources": [
        "resources/policy/base.md#学期补贴金额"
      ],
      "created_at": "2026-07-16T16:14:16+08:00",
      "supply": {
        "kind": "output",
        "zh": "每学期的入托入园补贴金额（二孩每学期1000，三孩2500）"
      }
    },
    {
      "id": "operator_95cd8d98f56d",
      "canonical_name": "孕检补贴标准",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "孕检补贴标准，每人一次性500元",
      "sources": [
        "resources/policy/base.md#孕检补贴标准"
      ],
      "created_at": "2026-07-16T16:14:16+08:00",
      "supply": {
        "kind": "output",
        "zh": "孕检补贴标准，每人一次性500元"
      }
    },
    {
      "id": "operator_e7f08349cee8",
      "canonical_name": "分娩补贴标准",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "分娩补贴标准，一次性2000元",
      "sources": [
        "resources/policy/base.md#分娩补贴标准"
      ],
      "created_at": "2026-07-16T16:14:16+08:00",
      "supply": {
        "kind": "output",
        "zh": "分娩补贴标准，一次性2000元"
      }
    },
    {
      "id": "operator_4fa2c6ee8498",
      "canonical_name": "就业补贴标准",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "托育执业人员就业补贴，一次性1000元",
      "sources": [
        "resources/policy/base.md#就业补贴标准"
      ],
      "created_at": "2026-07-16T16:14:16+08:00",
      "supply": {
        "kind": "output",
        "zh": "托育执业人员就业补贴，一次性1000元"
      }
    },
    {
      "id": "operator_e41220469012",
      "canonical_name": "按季度发放",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:补贴按季度发放",
      "sources": [
        "resources/policy/base.md#按季度发放"
      ],
      "created_at": "2026-07-16T16:17:05+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:补贴按季度发放"
      }
    },
    {
      "id": "operator_fde1db3dd8bf",
      "canonical_name": "父母再婚",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "婴幼儿的父母是否为再婚夫妻",
      "sources": [
        "resources/policy/base.md#父母再婚"
      ],
      "created_at": "2026-07-16T16:14:31+08:00",
      "supply": {
        "kind": "attr",
        "zh": "婴幼儿的父母是否为再婚夫妻",
        "hint": "说“父母是再婚”为true，否则false。"
      }
    },
    {
      "id": "operator_23f3ba4f699e",
      "canonical_name": "按季度首月15日前发放",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "补贴在每季度首月15日前发放",
      "sources": [
        "resources/policy/base.md#按季度首月15日前发放"
      ],
      "created_at": "2026-07-16T16:14:31+08:00",
      "supply": {
        "kind": "output",
        "zh": "补贴在每季度首月15日前发放"
      }
    },
    {
      "id": "operator_86d51a9bc39a",
      "canonical_name": "季度首月发放",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "补贴在下季度第一个月发放",
      "sources": [
        "resources/policy/base.md#季度首月发放"
      ],
      "created_at": "2026-07-16T16:14:35+08:00",
      "supply": {
        "kind": "output",
        "zh": "补贴在下季度第一个月发放"
      }
    },
    {
      "id": "operator_e85d2d981468",
      "canonical_name": "支持全程网办",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "该地域的育儿补贴政策是否支持全程网上办理（通过数据共享自动核验，无需线下提交材料）",
      "sources": [
        "resources/policy/base.md#支持全程网办"
      ],
      "created_at": "2026-07-16T16:14:35+08:00",
      "supply": {
        "kind": "attr",
        "zh": "该地域的育儿补贴政策是否支持全程网上办理（通过数据共享自动核验，无需线下提交材料）",
        "hint": "用户描述“全程网办”“网上就能办好”等"
      }
    },
    {
      "id": "operator_89d62e13f9e0",
      "canonical_name": "本自治区户籍",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "本自治区户籍",
      "sources": [
        "resources/policy/base.md#本自治区户籍"
      ],
      "created_at": "2026-07-16T16:14:37+08:00",
      "supply": {
        "kind": "attr",
        "zh": "本自治区户籍",
        "hint": "用户明确说明婴幼儿有新疆户籍/新疆籍，或在本地出生落户、父母均新疆户籍，均视为true"
      }
    },
    {
      "id": "operator_2ff2b80a6f39",
      "canonical_name": "季度第二个月发放",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:补贴在每季度第二个月的月底前发放（浙江）",
      "sources": [
        "resources/policy/base.md#季度第二个月发放"
      ],
      "created_at": "2026-07-16T16:14:39+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:补贴在每季度第二个月的月底前发放（浙江）"
      }
    },
    {
      "id": "operator_418f59ac5312",
      "canonical_name": "申请人本市户籍",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "申请人是否具有本市户籍",
      "sources": [
        "resources/policy/base.md#申请人本市户籍"
      ],
      "created_at": "2026-07-16T16:14:40+08:00",
      "supply": {
        "kind": "attr",
        "zh": "申请人是否具有本市户籍",
        "hint": "说“申请人有本市户口”为true，否则false。"
      }
    },
    {
      "id": "operator_5e21cc4694a7",
      "canonical_name": "首次登记户籍在本市",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "新出生子女户籍首次登记在本市",
      "sources": [
        "resources/policy/base.md#首次登记户籍在本市"
      ],
      "created_at": "2026-07-16T16:14:40+08:00",
      "supply": {
        "kind": "attr",
        "zh": "新出生子女户籍首次登记在本市",
        "hint": "说“孩子首次户口登记在本市”为true，否则false。"
      }
    },
    {
      "id": "operator_0b061105ad69",
      "canonical_name": "孕周数",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_1599de2c157c",
      "description": "申领人的怀孕周数",
      "sources": [
        "resources/policy/base.md#孕周数"
      ],
      "created_at": "2026-07-16T16:14:40+08:00",
      "supply": {
        "kind": "attr",
        "zh": "申领人的怀孕周数",
        "hint": "说'怀孕多少周'直接填数字，如'20周'>20。"
      }
    },
    {
      "id": "operator_609c1098813b",
      "canonical_name": "已建母子健康手册",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "申请人已建立《母子健康手册》",
      "sources": [
        "resources/policy/base.md#已建母子健康手册"
      ],
      "created_at": "2026-07-16T16:14:40+08:00",
      "supply": {
        "kind": "attr",
        "zh": "申请人已建立《母子健康手册》",
        "hint": "说'建了手册'或'已建'>true；'没建'>false。"
      }
    },
    {
      "id": "operator_a4a339050dfe",
      "canonical_name": "在出生后180日内",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "婴幼儿出生后180日内（自然日）",
      "sources": [
        "resources/policy/base.md#在出生后180日内"
      ],
      "created_at": "2026-07-16T16:14:40+08:00",
      "supply": {
        "kind": "attr",
        "zh": "婴幼儿出生后180日内（自然日）",
        "hint": "说'出生后X天'，X≤180>true，否则false。"
      }
    },
    {
      "id": "operator_4d54db776dde",
      "canonical_name": "在出生当年或次年",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "当前日期在婴幼儿出生当年或次年",
      "sources": [
        "resources/policy/base.md#在出生当年或次年"
      ],
      "created_at": "2026-07-16T16:14:40+08:00",
      "supply": {
        "kind": "attr",
        "zh": "当前日期在婴幼儿出生当年或次年",
        "hint": "说'今年出生'或'去年出生'，符合>true。"
      }
    },
    {
      "id": "operator_2d69a11d463d",
      "canonical_name": "属于孕产补助对象",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论：属于孕产补助对象",
      "sources": [
        "resources/policy/base.md#属于孕产补助对象"
      ],
      "created_at": "2026-07-16T16:14:40+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论：属于孕产补助对象"
      }
    },
    {
      "id": "operator_4f837ddae833",
      "canonical_name": "属于三孩补助对象",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论：属于三孩补助对象",
      "sources": [
        "resources/policy/base.md#属于三孩补助对象"
      ],
      "created_at": "2026-07-16T16:14:40+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论：属于三孩补助对象"
      }
    },
    {
      "id": "operator_4e2618d866a4",
      "canonical_name": "孕产补助标准",
      "input_concepts": [
        "concept_5a38f9b532f2",
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "孕产补助金额（二孩2000元，三孩5000元）",
      "sources": [
        "resources/policy/base.md#孕产补助标准"
      ],
      "created_at": "2026-07-16T16:14:40+08:00",
      "supply": {
        "kind": "output",
        "zh": "孕产补助金额（二孩2000元，三孩5000元）"
      }
    },
    {
      "id": "operator_d9d5a8c55303",
      "canonical_name": "三孩补助标准",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "三孩补助金额（9200元）",
      "sources": [
        "resources/policy/base.md#三孩补助标准"
      ],
      "created_at": "2026-07-16T16:14:40+08:00",
      "supply": {
        "kind": "output",
        "zh": "三孩补助金额（9200元）"
      }
    },
    {
      "id": "operator_bffc81b49abb",
      "canonical_name": "温州生育截止前",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "婴幼儿生育时间在2026年1月31日（含）之前",
      "sources": [
        "resources/policy/base.md#温州生育截止前"
      ],
      "created_at": "2026-07-16T16:14:40+08:00",
      "supply": {
        "kind": "attr",
        "zh": "婴幼儿生育时间在2026年1月31日（含）之前",
        "hint": "用户需明确婴幼儿出生日期在2026年1月31日之前（含当日），否则视为不符合温州一次性生育补贴的时间条件"
      }
    },
    {
      "id": "operator_ad24160507b8",
      "canonical_name": "可申领一次性生育补贴",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论:可申领一次性生育补贴",
      "sources": [
        "resources/policy/base.md#可申领一次性生育补贴"
      ],
      "created_at": "2026-07-16T16:14:50+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论:可申领一次性生育补贴"
      }
    },
    {
      "id": "operator_f66d5fcbc24d",
      "canonical_name": "出生日期",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_f207a9606710",
      "description": "获取婴幼儿的出生日期",
      "sources": [
        "resources/policy/base.md#出生日期"
      ],
      "created_at": "2026-07-16T16:14:43+08:00",
      "supply": {
        "kind": "attr",
        "zh": "获取婴幼儿的出生日期",
        "hint": "说'宝宝生日是YYYY-MM-DD'填入对应数值。"
      }
    },
    {
      "id": "operator_c2bb4281be57",
      "canonical_name": "户籍迁入日期",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_daf941d73252",
      "description": "获取婴幼儿的户籍迁入日期",
      "sources": [
        "resources/policy/base.md#户籍迁入日期"
      ],
      "created_at": "2026-07-16T16:14:43+08:00",
      "supply": {
        "kind": "attr",
        "zh": "获取婴幼儿的户籍迁入日期",
        "hint": "说'户籍迁入日期是YYYY-MM-DD'填入对应数值。"
      }
    },
    {
      "id": "operator_89a0ac4c4429",
      "canonical_name": "夫妻至少一方本地户籍",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "判断婴幼儿父母至少一方具有本地（如衢州）户籍",
      "sources": [
        "resources/policy/base.md#夫妻至少一方本地户籍"
      ],
      "created_at": "2026-07-16T16:14:43+08:00",
      "supply": {
        "kind": "attr",
        "zh": "判断婴幼儿父母至少一方具有本地（如衢州）户籍",
        "hint": "用户提到“夫妻一方是本地户口的”、“父母一方有本地户籍”等视为true"
      }
    },
    {
      "id": "operator_846fae852661",
      "canonical_name": "户籍迁入满一年",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "判断从户籍迁入之日起是否已满一年（隐含使用当前日期）",
      "sources": [
        "resources/policy/base.md#户籍迁入满一年"
      ],
      "created_at": "2026-07-16T16:14:43+08:00",
      "supply": {
        "kind": "output",
        "zh": "判断从户籍迁入之日起是否已满一年（隐含使用当前日期）"
      }
    },
    {
      "id": "operator_367356e4d671",
      "canonical_name": "衢州市育儿补贴标准",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "符合衢州市《实施意见》的育儿补贴标准（元/年），二孩5000，三孩10000",
      "sources": [
        "resources/policy/base.md#衢州市育儿补贴标准"
      ],
      "created_at": "2026-07-16T16:14:43+08:00",
      "supply": {
        "kind": "output",
        "zh": "符合衢州市《实施意见》的育儿补贴标准（元/年），二孩5000，三孩10000"
      }
    },
    {
      "id": "operator_d15709dbf8f7",
      "canonical_name": "浙江省育儿补贴标准",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "浙江省统一的育儿补贴标准（元/月），当前为每孩每月300元",
      "sources": [
        "resources/policy/base.md#浙江省育儿补贴标准"
      ],
      "created_at": "2026-07-16T16:14:43+08:00",
      "supply": {
        "kind": "output",
        "zh": "浙江省统一的育儿补贴标准（元/月），当前为每孩每月300元"
      }
    },
    {
      "id": "operator_77d720d3dace",
      "canonical_name": "消费补贴标准",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "衢州市二孩三孩消费补贴标准（元/年），二孩1400，三孩6400",
      "sources": [
        "resources/policy/base.md#消费补贴标准"
      ],
      "created_at": "2026-07-16T16:14:43+08:00",
      "supply": {
        "kind": "output",
        "zh": "衢州市二孩三孩消费补贴标准（元/年），二孩1400，三孩6400"
      }
    },
    {
      "id": "operator_c7adbb3ed546",
      "canonical_name": "可申领消费补贴",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论：该婴幼儿可申领衢州市消费补贴",
      "sources": [
        "resources/policy/base.md#可申领消费补贴"
      ],
      "created_at": "2026-07-16T16:14:43+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论：该婴幼儿可申领衢州市消费补贴"
      }
    },
    {
      "id": "operator_ea805b1cbcdf",
      "canonical_name": "消费补贴可选用健康服务券",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论：消费补贴可自主选择现金或健康服务券",
      "sources": [
        "resources/policy/base.md#消费补贴可选用健康服务券"
      ],
      "created_at": "2026-07-16T16:14:43+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论：消费补贴可自主选择现金或健康服务券"
      }
    },
    {
      "id": "operator_dd6c54cc7e28",
      "canonical_name": "大于等于",
      "input_concepts": [
        "concept_c4531d3c4fc2",
        "concept_c4531d3c4fc2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "大于等于",
      "sources": [
        "resources/policy/base.md#大于等于"
      ],
      "created_at": "2026-07-16T16:14:45+08:00",
      "supply": {
        "kind": "action",
        "zh": "大于等于"
      }
    },
    {
      "id": "operator_62fc9b14d544",
      "canonical_name": "首次申请在2025年12月31日及以前",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "首次申请在2025年12月31日及以前",
      "sources": [
        "resources/policy/base.md#首次申请在2025年12月31日及以前"
      ],
      "created_at": "2026-07-16T16:14:45+08:00",
      "supply": {
        "kind": "attr",
        "zh": "首次申请在2025年12月31日及以前",
        "hint": "说'首次申请在2025年底前'>true，否则false。"
      }
    },
    {
      "id": "operator_143d0072c9d6",
      "canonical_name": "核实已用工作日",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "核实已用工作日",
      "sources": [
        "resources/policy/base.md#核实已用工作日"
      ],
      "created_at": "2026-07-16T16:14:45+08:00",
      "supply": {
        "kind": "attr",
        "zh": "核实已用工作日",
        "hint": "说'已用X个工作日'填入X。"
      }
    },
    {
      "id": "operator_c02b4eb2d2e8",
      "canonical_name": "海南初审超期",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "海南初审超期",
      "sources": [
        "resources/policy/base.md#海南初审超期"
      ],
      "created_at": "2026-07-16T16:14:45+08:00",
      "supply": {
        "kind": "output",
        "zh": "海南初审超期"
      }
    },
    {
      "id": "operator_50bea180bc32",
      "canonical_name": "海南审核确认超期",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "海南审核确认超期",
      "sources": [
        "resources/policy/base.md#海南审核确认超期"
      ],
      "created_at": "2026-07-16T16:14:45+08:00",
      "supply": {
        "kind": "output",
        "zh": "海南审核确认超期"
      }
    },
    {
      "id": "operator_b40213aba1ba",
      "canonical_name": "海南核实超期",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "海南核实超期",
      "sources": [
        "resources/policy/base.md#海南核实超期"
      ],
      "created_at": "2026-07-16T16:14:45+08:00",
      "supply": {
        "kind": "output",
        "zh": "海南核实超期"
      }
    },
    {
      "id": "operator_cc356c11e57c",
      "canonical_name": "海南季度内集中发放",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "海南季度内集中发放",
      "sources": [
        "resources/policy/base.md#海南季度内集中发放"
      ],
      "created_at": "2026-07-16T16:14:45+08:00",
      "supply": {
        "kind": "output",
        "zh": "海南季度内集中发放"
      }
    },
    {
      "id": "operator_aa2487c624b8",
      "canonical_name": "湖北首次申请在2025年底前",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "对于2025年1月1日前出生的婴幼儿，是否在2025年12月31日前提出首次申请",
      "sources": [
        "resources/policy/base.md#湖北首次申请在2025年底前"
      ],
      "created_at": "2026-07-16T16:14:47+08:00",
      "supply": {
        "kind": "attr",
        "zh": "对于2025年1月1日前出生的婴幼儿，是否在2025年12月31日前提出首次申请",
        "hint": "用户提到申请时间在2025年底前时填true"
      }
    },
    {
      "id": "operator_d39cdad6dc72",
      "canonical_name": "出生在2022-01-01及之后",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "婴幼儿出生日期在2022年1月1日及以后",
      "sources": [
        "resources/policy/base.md#出生在2022-01-01及之后"
      ],
      "created_at": "2026-07-16T16:14:49+08:00",
      "supply": {
        "kind": "attr",
        "zh": "婴幼儿出生日期在2022年1月1日及以后",
        "hint": "用户提到出生日期在2022年1月1日及以后，填true；否则false"
      }
    },
    {
      "id": "operator_c1755d4fe1e5",
      "canonical_name": "是未成年人救助保护机构",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "申领人是未成年人救助保护机构",
      "sources": [
        "resources/policy/base.md#是未成年人救助保护机构"
      ],
      "created_at": "2026-07-16T16:14:49+08:00",
      "supply": {
        "kind": "attr",
        "zh": "申领人是未成年人救助保护机构",
        "hint": "用户提到申领人是未成年人救助保护机构，填true；否则false"
      }
    },
    {
      "id": "operator_c407256f3518",
      "canonical_name": "出生在2024年1月4日后",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "婴幼儿出生日期在2024年1月4日及以后",
      "sources": [
        "resources/policy/base.md#出生在2024年1月4日后"
      ],
      "created_at": "2026-07-16T16:14:50+08:00",
      "supply": {
        "kind": "attr",
        "zh": "婴幼儿出生日期在2024年1月4日及以后",
        "hint": "出生日期在2024年1月4日及之后填true，否则false"
      }
    },
    {
      "id": "operator_c5de34c9fd0c",
      "canonical_name": "一次性补贴标准",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "根据孩次确定一次性补贴金额，二孩2000元，三孩及以上10000元",
      "sources": [
        "resources/policy/base.md#一次性补贴标准"
      ],
      "created_at": "2026-07-16T16:14:50+08:00",
      "supply": {
        "kind": "output",
        "zh": "根据孩次确定一次性补贴金额，二孩2000元，三孩及以上10000元"
      }
    },
    {
      "id": "operator_5bec2b71df25",
      "canonical_name": "接受辅助生殖",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "申领人是否接受辅助生殖治疗",
      "sources": [
        "resources/policy/base.md#接受辅助生殖"
      ],
      "created_at": "2026-07-16T16:14:51+08:00",
      "supply": {
        "kind": "attr",
        "zh": "申领人是否接受辅助生殖治疗",
        "hint": "说'做过辅助生殖'>true；'自然怀孕'>false。"
      }
    },
    {
      "id": "operator_31ec1d7b8ec0",
      "canonical_name": "辅助生殖方式",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_66633871ca25",
      "description": "申领人接受的辅助生殖方式",
      "sources": [
        "resources/policy/base.md#辅助生殖方式"
      ],
      "created_at": "2026-07-16T16:14:51+08:00",
      "supply": {
        "kind": "attr",
        "zh": "申领人接受的辅助生殖方式",
        "hint": "说'人工授精'或'试管婴儿'对应枚举值。"
      }
    },
    {
      "id": "operator_15f3c2a12f75",
      "canonical_name": "本市医疗机构内辅助生殖",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "辅助生殖是否在本市医疗机构内进行",
      "sources": [
        "resources/policy/base.md#本市医疗机构内辅助生殖"
      ],
      "created_at": "2026-07-16T16:14:51+08:00",
      "supply": {
        "kind": "attr",
        "zh": "辅助生殖是否在本市医疗机构内进行",
        "hint": "说'在本市医院做'>true；'外地'>false。"
      }
    },
    {
      "id": "operator_21d007b32c23",
      "canonical_name": "父母至少一方本市户籍",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "婴幼儿的父母至少一方具有本市户籍",
      "sources": [
        "resources/policy/base.md#父母至少一方本市户籍"
      ],
      "created_at": "2026-07-16T16:14:51+08:00",
      "supply": {
        "kind": "attr",
        "zh": "婴幼儿的父母至少一方具有本市户籍",
        "hint": "说'有本市户口'>true；'都没有'>false。"
      }
    },
    {
      "id": "operator_124ef52c6c42",
      "canonical_name": "父母至少一方参加本市社保",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "婴幼儿的父母至少一方参加本市社会保险",
      "sources": [
        "resources/policy/base.md#父母至少一方参加本市社保"
      ],
      "created_at": "2026-07-16T16:14:51+08:00",
      "supply": {
        "kind": "attr",
        "zh": "婴幼儿的父母至少一方参加本市社会保险",
        "hint": "说'有交本市社保'>true；'没有'>false。"
      }
    },
    {
      "id": "operator_f9da461ddd65",
      "canonical_name": "在公办幼儿园就读",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "婴幼儿在当前学期在公办幼儿园就读",
      "sources": [
        "resources/policy/base.md#在公办幼儿园就读"
      ],
      "created_at": "2026-07-16T16:14:51+08:00",
      "supply": {
        "kind": "attr",
        "zh": "婴幼儿在当前学期在公办幼儿园就读",
        "hint": "说'在公立园'>true；'不在'>false。"
      }
    },
    {
      "id": "operator_5ae873ca6241",
      "canonical_name": "在民办幼儿园就读",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "婴幼儿在当前学期在民办幼儿园就读",
      "sources": [
        "resources/policy/base.md#在民办幼儿园就读"
      ],
      "created_at": "2026-07-16T16:14:51+08:00",
      "supply": {
        "kind": "attr",
        "zh": "婴幼儿在当前学期在民办幼儿园就读",
        "hint": "说'在民办园'>true；'不在'>false。"
      }
    },
    {
      "id": "operator_aff6c0c6a608",
      "canonical_name": "购买新建商品住房",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "家庭购买中心城区新建商品住房",
      "sources": [
        "resources/policy/base.md#购买新建商品住房"
      ],
      "created_at": "2026-07-16T16:14:51+08:00",
      "supply": {
        "kind": "attr",
        "zh": "家庭购买中心城区新建商品住房",
        "hint": "说“买了中心城区新房”填true，否则false。"
      }
    },
    {
      "id": "operator_805b05e631a5",
      "canonical_name": "人工授精补贴",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "人工授精补贴金额（最高3000元）",
      "sources": [
        "resources/policy/base.md#人工授精补贴"
      ],
      "created_at": "2026-07-16T16:14:51+08:00",
      "supply": {
        "kind": "output",
        "zh": "人工授精补贴金额（最高3000元）"
      }
    },
    {
      "id": "operator_c2789b508320",
      "canonical_name": "试管婴儿补贴",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "试管婴儿补贴金额（最高10000元）",
      "sources": [
        "resources/policy/base.md#试管婴儿补贴"
      ],
      "created_at": "2026-07-16T16:14:51+08:00",
      "supply": {
        "kind": "output",
        "zh": "试管婴儿补贴金额（最高10000元）"
      }
    },
    {
      "id": "operator_15d054b5772a",
      "canonical_name": "月育儿补贴标准",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "每月育儿补贴金额（元/月）",
      "sources": [
        "resources/policy/base.md#月育儿补贴标准"
      ],
      "created_at": "2026-07-16T16:14:51+08:00",
      "supply": {
        "kind": "output",
        "zh": "每月育儿补贴金额（元/月）"
      }
    },
    {
      "id": "operator_71a89883e695",
      "canonical_name": "免保教费",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "是否享受学前教育保育教育费减免",
      "sources": [
        "resources/policy/base.md#免保教费"
      ],
      "created_at": "2026-07-16T16:14:51+08:00",
      "supply": {
        "kind": "output",
        "zh": "是否享受学前教育保育教育费减免"
      }
    },
    {
      "id": "operator_f62cf46debef",
      "canonical_name": "可长幼随学",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "是否可申请长幼随学",
      "sources": [
        "resources/policy/base.md#可长幼随学"
      ],
      "created_at": "2026-07-16T16:14:51+08:00",
      "supply": {
        "kind": "output",
        "zh": "是否可申请长幼随学"
      }
    },
    {
      "id": "operator_c420b1b0cdf1",
      "canonical_name": "购房补贴金额",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "一次性购房补贴金额（元）",
      "sources": [
        "resources/policy/base.md#购房补贴金额"
      ],
      "created_at": "2026-07-16T16:14:51+08:00",
      "supply": {
        "kind": "output",
        "zh": "一次性购房补贴金额（元）"
      }
    },
    {
      "id": "operator_0b7dc3bbd015",
      "canonical_name": "公积金贷款额度上浮比例",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "公积金贷款最高额度上浮百分比（如20）",
      "sources": [
        "resources/policy/base.md#公积金贷款额度上浮比例"
      ],
      "created_at": "2026-07-16T16:14:51+08:00",
      "supply": {
        "kind": "output",
        "zh": "公积金贷款最高额度上浮百分比（如20）"
      }
    },
    {
      "id": "operator_7a0c5fa6e997",
      "canonical_name": "执行首套房利率",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "是否执行首套房贷款利率",
      "sources": [
        "resources/policy/base.md#执行首套房利率"
      ],
      "created_at": "2026-07-16T16:14:51+08:00",
      "supply": {
        "kind": "output",
        "zh": "是否执行首套房贷款利率"
      }
    },
    {
      "id": "operator_95e5ad8faf82",
      "canonical_name": "公积金提取放宽",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "是否可按实际房租提取住房公积金",
      "sources": [
        "resources/policy/base.md#公积金提取放宽"
      ],
      "created_at": "2026-07-16T16:14:51+08:00",
      "supply": {
        "kind": "output",
        "zh": "是否可按实际房租提取住房公积金"
      }
    },
    {
      "id": "operator_8ca562d6c1c5",
      "canonical_name": "公租房优先",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "公租房配租是否优先",
      "sources": [
        "resources/policy/base.md#公租房优先"
      ],
      "created_at": "2026-07-16T16:14:51+08:00",
      "supply": {
        "kind": "output",
        "zh": "公租房配租是否优先"
      }
    },
    {
      "id": "operator_fb63dbab79ec",
      "canonical_name": "产假延长天数",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "延长产假的天数",
      "sources": [
        "resources/policy/base.md#产假延长天数"
      ],
      "created_at": "2026-07-16T16:14:51+08:00",
      "supply": {
        "kind": "output",
        "zh": "延长产假的天数"
      }
    },
    {
      "id": "operator_3a39786ee922",
      "canonical_name": "配偶护理假延长天数",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "延长配偶护理假的天数",
      "sources": [
        "resources/policy/base.md#配偶护理假延长天数"
      ],
      "created_at": "2026-07-16T16:14:51+08:00",
      "supply": {
        "kind": "output",
        "zh": "延长配偶护理假的天数"
      }
    },
    {
      "id": "operator_392d783f8c2b",
      "canonical_name": "职称评聘优先",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "专业技术人员职称评聘时是否优先",
      "sources": [
        "resources/policy/base.md#职称评聘优先"
      ],
      "created_at": "2026-07-16T16:14:51+08:00",
      "supply": {
        "kind": "output",
        "zh": "专业技术人员职称评聘时是否优先"
      }
    },
    {
      "id": "operator_4d61b44ded4e",
      "canonical_name": "配偶工作安排",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "是否可申请配偶对等对等安排来荆工作",
      "sources": [
        "resources/policy/base.md#配偶工作安排"
      ],
      "created_at": "2026-07-16T16:14:51+08:00",
      "supply": {
        "kind": "output",
        "zh": "是否可申请配偶对等对等安排来荆工作"
      }
    },
    {
      "id": "operator_160a244aeb79",
      "canonical_name": "免门票",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "是否享受政府定价旅游景区免门票",
      "sources": [
        "resources/policy/base.md#免门票"
      ],
      "created_at": "2026-07-16T16:14:51+08:00",
      "supply": {
        "kind": "output",
        "zh": "是否享受政府定价旅游景区免门票"
      }
    },
    {
      "id": "operator_300b66e32668",
      "canonical_name": "西藏县级审核超期",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "县级卫生健康部门审核超过15工作日的结论",
      "sources": [
        "resources/policy/base.md#西藏县级审核超期"
      ],
      "created_at": "2026-07-16T16:14:53+08:00",
      "supply": {
        "kind": "output",
        "zh": "县级卫生健康部门审核超过15工作日的结论"
      }
    },
    {
      "id": "operator_349b008d3133",
      "canonical_name": "每半年集中发放",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "育儿补贴每半年集中发放一批",
      "sources": [
        "resources/policy/base.md#每半年集中发放"
      ],
      "created_at": "2026-07-16T16:14:53+08:00",
      "supply": {
        "kind": "output",
        "zh": "育儿补贴每半年集中发放一批"
      }
    },
    {
      "id": "operator_51a9a970bc3e",
      "canonical_name": "申请在迁移前",
      "input_concepts": [
        "concept_5a38f9b532f2",
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "申领人在婴儿户籍迁移前已提交申请",
      "sources": [
        "resources/policy/base.md#申请在迁移前"
      ],
      "created_at": "2026-07-16T16:14:53+08:00",
      "supply": {
        "kind": "attr",
        "zh": "申领人在婴儿户籍迁移前已提交申请",
        "hint": "说“迁户口前已申请”填true，否则false。"
      }
    },
    {
      "id": "operator_0084d212074c",
      "canonical_name": "已完成注册认证",
      "input_concepts": [
        "concept_5a38f9b532f2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "申领人是否在指定平台完成注册和实名认证",
      "sources": [
        "resources/policy/base.md#已完成注册认证"
      ],
      "created_at": "2026-07-16T16:14:54+08:00",
      "supply": {
        "kind": "attr",
        "zh": "申领人是否在指定平台完成注册和实名认证",
        "hint": "用户提到在多彩宝APP或贵人服务小程序注册认证，填true"
      }
    },
    {
      "id": "operator_051b9c7211c7",
      "canonical_name": "已提交当年申请",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "婴幼儿当年是否已提交育儿补贴申请",
      "sources": [
        "resources/policy/base.md#已提交当年申请"
      ],
      "created_at": "2026-07-16T16:14:56+08:00",
      "supply": {
        "kind": "attr",
        "zh": "婴幼儿当年是否已提交育儿补贴申请",
        "hint": "用户提到‘已申领’‘已申请’当年补贴等，填true；若未提交，则false"
      }
    },
    {
      "id": "operator_2198d9f542f5",
      "canonical_name": "季度末发放",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "结论：育儿补贴在每季度最后一日前发放到位（陕西省）",
      "sources": [
        "resources/policy/base.md#季度末发放"
      ],
      "created_at": "2026-07-16T16:14:57+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论：育儿补贴在每季度最后一日前发放到位（陕西省）"
      }
    },
    {
      "id": "operator_43cf8abb3a9e",
      "canonical_name": "父母一方有本市户籍",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "婴幼儿父母至少一方具有本市户籍",
      "sources": [
        "resources/policy/base.md#父母一方有本市户籍"
      ],
      "created_at": "2026-07-16T16:15:00+08:00",
      "supply": {
        "kind": "attr",
        "zh": "婴幼儿父母至少一方具有本市户籍",
        "hint": "说“爸爸或妈妈有本地户口”填true，否则false。"
      }
    },
    {
      "id": "operator_f8898792f7ae",
      "canonical_name": "过渡期内出生",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "出生日期在2025年1月1日至2026年12月31日之间",
      "sources": [
        "resources/policy/base.md#过渡期内出生"
      ],
      "created_at": "2026-07-16T16:15:00+08:00",
      "supply": {
        "kind": "attr",
        "zh": "出生日期在2025年1月1日至2026年12月31日之间",
        "hint": "出生在2025.1.1-2026.12.31填true，否则false。"
      }
    },
    {
      "id": "operator_40b33efa865d",
      "canonical_name": "适用新人新政策",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "该婴幼儿适用新人新政策",
      "sources": [
        "resources/policy/base.md#适用新人新政策"
      ],
      "created_at": "2026-07-16T16:15:00+08:00",
      "supply": {
        "kind": "output",
        "zh": "该婴幼儿适用新人新政策"
      }
    },
    {
      "id": "operator_a7e76455ee2c",
      "canonical_name": "适用老人老政策",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "该婴幼儿适用老人老政策",
      "sources": [
        "resources/policy/base.md#适用老人老政策"
      ],
      "created_at": "2026-07-16T16:15:00+08:00",
      "supply": {
        "kind": "output",
        "zh": "该婴幼儿适用老人老政策"
      }
    },
    {
      "id": "operator_62a17dfffc76",
      "canonical_name": "不计入孩次",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "该婴幼儿在计算孩次时不计入（如收养、死亡、他人生育等情形）",
      "sources": [
        "resources/policy/base.md#不计入孩次"
      ],
      "created_at": "2026-07-16T16:17:05+08:00",
      "supply": {
        "kind": "attr",
        "zh": "该婴幼儿在计算孩次时不计入（如收养、死亡、他人生育等情形）",
        "hint": "收养、死亡、他人生育等填true，正常填false。"
      }
    },
    {
      "id": "operator_6ff99b6cc7a4",
      "canonical_name": "他人生育",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "婴幼儿为配偶在婚姻存续期间与他人生育的子女",
      "sources": [
        "resources/policy/base.md#他人生育"
      ],
      "created_at": "2026-07-16T16:17:05+08:00",
      "supply": {
        "kind": "attr",
        "zh": "婴幼儿为配偶在婚姻存续期间与他人生育的子女",
        "hint": "配偶与他人生育的子女填true，否则false。"
      }
    },
    {
      "id": "operator_07ab9279c121",
      "canonical_name": "审核确认超期_通用",
      "input_concepts": [
        "concept_5a38f9b532f2",
        "concept_c4531d3c4fc2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "审核确认环节超过法定时限（需输入法定时限工作日数）",
      "sources": [
        "resources/policy/base.md#审核确认超期_通用"
      ],
      "created_at": "2026-07-16T16:17:05+08:00",
      "supply": {
        "kind": "output",
        "zh": "审核确认环节超过法定时限（需输入法定时限工作日数）"
      }
    },
    {
      "id": "operator_53d2aa61b3d2",
      "canonical_name": "小于等于",
      "input_concepts": [
        "concept_c4531d3c4fc2",
        "concept_c4531d3c4fc2"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "数值比较 <=（引擎实时计算）",
      "sources": [
        "resources/policy/base.md#小于等于"
      ],
      "created_at": "2026-07-16T15:57:07+08:00",
      "supply": {
        "kind": "action",
        "zh": "数值比较 <=（引擎实时计算）"
      }
    },
    {
      "id": "operator_9f145441031c",
      "canonical_name": "发放至实名制结算账户",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "补贴发放至申领人或婴幼儿在金融机构开立的实名制结算账户",
      "sources": [
        "QA#8"
      ],
      "created_at": "2026-07-16T15:57:07+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论：补贴发放至实名制结算账户"
      }
    },
    {
      "id": "operator_099ad28e6c06",
      "canonical_name": "迁出前申请按原户籍地政策办理",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "户籍迁出前已提交的申请，按照迁出前户籍所在地政策办理",
      "sources": [
        "QA#10"
      ],
      "created_at": "2026-07-16T15:57:07+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论：迁出前申请按原户籍地政策办理"
      }
    },
    {
      "id": "operator_f8fc21a841e5",
      "canonical_name": "通过一卡通发放",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "育儿补贴通过天津市惠民惠农财政补贴资金一卡通渠道发放",
      "sources": [
        "知识#9"
      ],
      "created_at": "2026-07-16T15:57:07+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论：通过天津市惠民惠农一卡通渠道发放"
      }
    },
    {
      "id": "operator_d4f731fd8252",
      "canonical_name": "户籍迁入不足整年",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "满一年后开始申报消费补贴时，按实际迁入时间计算的首个补贴期不足一年",
      "sources": [
        "resources/policy/浙江省-衢州市.md#知识8"
      ],
      "created_at": "2026-07-16T15:57:07+08:00",
      "supply": {
        "kind": "attr",
        "zh": "户籍迁入后首个可补贴期间是否不足整年",
        "hint": "迁入后首个补贴期不足一年填true，否则false。"
      }
    },
    {
      "id": "operator_bed7f90bf9e9",
      "canonical_name": "出生在2022年1月1日及以后",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "婴幼儿出生日期为2022年1月1日及以后",
      "sources": [
        "知识#1"
      ],
      "created_at": "2026-07-16T15:57:07+08:00",
      "supply": {
        "kind": "attr",
        "zh": "婴幼儿是否在2022年1月1日及以后出生",
        "hint": "出生日期>=2022-01-01填true，否则false。"
      }
    },
    {
      "id": "operator_f2df3bfb81d8",
      "canonical_name": "政策认定子女序号",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "按潜江政策口径认定的奖励序号：普通家庭按夫妻曾生育并存活子女确定且不计收养；再婚家庭仅计现夫妻共同生育；多胞胎按叠加规则标记为2或3，同批需叠加的其余婴幼儿均标记为3",
      "sources": [
        "resources/policy/湖北省-潜江市.md#知识3"
      ],
      "created_at": "2026-07-16T15:57:07+08:00",
      "supply": {
        "kind": "attr",
        "zh": "按潜江孩次口径认定的子女序号",
        "hint": "普通家庭按夫妻曾经生育并存活子女计数，收养子女不计；再婚家庭只计现夫妻共同生育子女；多胞胎按政策叠加口径分别标记为2或3，同批需要享受三孩奖励的其余婴幼儿均填3，不按4、5继续递增"
      }
    },
    {
      "id": "operator_bc9d21000524",
      "canonical_name": "政策认定孩次",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_4bdd767376a9",
      "description": "由潜江市政策认定子女序号推导的二孩、三孩或三孩以上",
      "sources": [
        "resources/policy/湖北省-潜江市.md#知识3"
      ],
      "created_at": "2026-07-16T15:57:07+08:00",
      "supply": {
        "kind": "attr",
        "zh": "潜江市政策口径认定的孩次",
        "hint": "说“一孩/二孩/三孩/三孩以上”对应枚举值。"
      }
    },
    {
      "id": "operator_f6b243120d82",
      "canonical_name": "系婴幼儿母亲",
      "input_concepts": [
        "concept_5a38f9b532f2",
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "申请人为该婴幼儿母亲",
      "sources": [
        "知识#14"
      ],
      "created_at": "2026-07-16T15:57:07+08:00",
      "supply": {
        "kind": "attr",
        "zh": "申请人是否为该婴幼儿母亲",
        "hint": "申请人是婴儿母亲填true，否则false。"
      }
    },
    {
      "id": "operator_e10c1eebd7c6",
      "canonical_name": "系婴幼儿母亲配偶",
      "input_concepts": [
        "concept_5a38f9b532f2",
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "申请人为生育该婴幼儿的母亲之配偶",
      "sources": [
        "知识#14"
      ],
      "created_at": "2026-07-16T15:57:07+08:00",
      "supply": {
        "kind": "attr",
        "zh": "申请人是否为该婴幼儿母亲的配偶",
        "hint": "申请人是婴儿母亲的配偶填true，否则false。"
      }
    },
    {
      "id": "operator_830017f9d2c3",
      "canonical_name": "系婴幼儿父母",
      "input_concepts": [
        "concept_5a38f9b532f2",
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "申请人为该婴幼儿父亲或母亲",
      "sources": [
        "知识#15"
      ],
      "created_at": "2026-07-16T15:57:07+08:00",
      "supply": {
        "kind": "attr",
        "zh": "申请人是否为该婴幼儿父母一方",
        "hint": "申请人是婴儿父母一方填true，否则false。"
      }
    },
    {
      "id": "operator_5face2a18d48",
      "canonical_name": "迁出前已申领当年补贴",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "户籍迁出前已申领当年育儿补贴",
      "sources": [
        "知识#19"
      ],
      "created_at": "2026-07-16T10:35:42+08:00",
      "supply": {
        "kind": "attr",
        "zh": "户籍迁出前是否已申领当年育儿补贴",
        "hint": "迁出前已领当年育儿补贴填true，否则false。"
      }
    },
    {
      "id": "operator_e1de8a7cdf96",
      "canonical_name": "迁出当年不得在迁入地重复申请",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "户籍迁出前已申领当年补贴的，当年不能再在迁入地申请",
      "sources": [
        "知识#19"
      ],
      "created_at": "2026-07-16T15:57:07+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论：迁出当年不得在迁入地重复申请"
      }
    },
    {
      "id": "operator_26b4e28a8952",
      "canonical_name": "迁出当年应在迁入地享受",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "户籍迁出前未申领当年补贴的，当年应在迁入地享受",
      "sources": [
        "知识#19"
      ],
      "created_at": "2026-07-16T15:57:07+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论：迁出当年应在迁入地享受育儿补贴"
      }
    },
    {
      "id": "operator_2c15b0f5100f",
      "canonical_name": "在政策衔接期内未满3周岁",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "2025年1月1日至2026年4月27日期间不满3周岁",
      "sources": [
        "知识#1"
      ],
      "created_at": "2026-07-16T15:57:07+08:00",
      "supply": {
        "kind": "attr",
        "zh": "婴幼儿是否在2025年1月1日至2026年4月27日期间不满3周岁",
        "hint": "2025.1.1-2026.4.27期间未满3岁填true，否则false。"
      }
    },
    {
      "id": "operator_d2bc4da07d01",
      "canonical_name": "未纳入衔接政策",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_866619eb6b93",
      "description": "该子女未纳入哈尔滨市地方育儿补贴衔接政策",
      "sources": [
        "知识#4"
      ],
      "created_at": "2026-07-16T15:57:07+08:00",
      "supply": {
        "kind": "attr",
        "zh": "该子女是否未纳入哈尔滨市地方衔接政策",
        "hint": "该子女未纳入本地衔接政策填true，否则false。"
      }
    },
    {
      "id": "operator_37219dbe321a",
      "canonical_name": "国家基础月补贴标准",
      "input_concepts": [
        "concept_a59613efb06e"
      ],
      "output_concept": "concept_c4531d3c4fc2",
      "description": "国家基础育儿补贴标准，元/月",
      "sources": [
        "知识#4"
      ],
      "created_at": "2026-07-16T15:57:07+08:00",
      "supply": {
        "kind": "output",
        "zh": "结论：国家基础育儿补贴月标准"
      }
    }
  ]
}

```
