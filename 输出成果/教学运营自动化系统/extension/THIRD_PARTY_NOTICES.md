# 第三方组件与许可

浏览器扩展只加载本包内的第三方脚本，不在运行时从CDN下载代码。

| 组件 | 固定版本 | 来源 | 许可文件 |
|---|---|---|---|
| PDF.js / pdfjs-dist | 4.10.38 | https://www.npmjs.com/package/pdfjs-dist/v/4.10.38 | vendor/pdfjs/LICENSE（Apache-2.0） |
| SheetJS Community Edition | 0.20.3 | https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js | vendor/xlsx/LICENSE（Apache-2.0） |

源码的config/vendor-integrity.json记录脚本SHA-256；发布检查核对原件字节，升级组件需重新审查并更新清单。第三方许可只适用于对应组件，不代表本项目采用相同许可。
