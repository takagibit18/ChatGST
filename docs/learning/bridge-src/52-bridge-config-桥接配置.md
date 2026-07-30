# Bridge 根 config.json

> 源文件：`bridge/config.json`

```json
{
  "workspaceDir": "/opt/chatgst/workspace",
  "auth": {
    "username": "admin",
    "password": "<admin-password>",
    "displayName": "系统管理员",
    "role": "平台超管",
    "email": "admin@data.gov.cn"
  },
  "ontoPlatform": {
    "url": "https://onto-platform.example.com",
    "username": "<onto-username>",
    "password": "<onto-password>"
  },
  "step2": {
    "default_data_root": "/home/wangjinwang/data/okfdata/policies3/policies2/data"
  },
  "server": {
    "port": 8787,
    "host": "0.0.0.0"
  },
  "crawler": {
    "baseUrl": "http://127.0.0.1:8000",
    "exportDir": "/opt/chatgst/export"
  }
}
```
