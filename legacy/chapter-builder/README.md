> 旧版开发参考目录。教师请优先使用[扩展安装指南](../../INSTALL.md)。此目录不继承扩展的全部审核门禁，不是同事推荐入口；不包含真实课程配置，旧写入默认关闭或要求操作者审查确认。

# 学习通章节创建工具

用于学习通课程中，基于已存在的任务章节复制六个模块结构，并把新章节准确创建到指定父章节下。

## 当前实现

- 自动登录并复用登录态
- 从课程列表进入指定课程
- 打开 `章节` 页后，进入来源章节编辑器
- `sourceTitle` 仅作为模板来源，用于复制六个模块结构
- `targetParentTitle` 单独指定新章节挂载到哪个父章节下
- 父章节下已有二级章节时自动追加；没有二级章节时自动创建第一个二级章节
- 自动复制来源章节的标签页结构
- 自动重命名新章节
- 自动校验目标章节和标签页是否创建成功
- 支持按六个模块标题自动写入章节正文
- 遇到占位章节 `新建课程目录` 时，先删除再重建

## 安装

```bash
npm install
cp .env.example .env
```

## 运行

```bash
npm run start -- --input ./data/chapters.json
```

只校验输入结构：

```bash
npm run dry-run -- --input ./data/chapters.example.json
```

统一入口：

```bash
./run_chapter_create_workflow.sh validate
./run_chapter_create_workflow.sh dry-run
./run_chapter_create_workflow.sh start
```

## 输入格式

```json
[
  {
    "sourceTitle": "任务一：文本向量化的离散化表示",
    "targetParentTitle": "文本向量化",
    "targetTitle": "任务二：文本向量化的分布式表示",
    "expectedCode": "7.2",
    "copyCards": true,
    "tabs": [
      "任务教学目标",
      "任务分析与效果",
      "知识点讲解",
      "任务实施",
      "微课视频",
      "任务总结与拓展"
    ],
    "cardContents": {
      "任务教学目标": "<p>知识目标：</p><p>……</p>",
      "任务分析与效果": "<p>任务描述：</p><p>……</p>"
    }
  }
]
```

字段说明：

- `sourceTitle`：已有来源章节标题，只负责提供六个模块模板
- `targetParentTitle`：目标父章节标题，新章节会挂在它下面
- `targetTitle`：新章节标题
- `expectedCode`：预期编号，例如 `7.2`
- `copyCards`：是否复制来源章节的标签页结构，默认 `true`
- `tabs`：校验用标签页名称列表，不填则使用默认 6 个模块
- `cardContents`：按卡片标题写入 HTML 正文；若章节已存在，也会按标题更新对应模块内容

## 目录

- `src/main.js`：入口
- `src/lib/config.js`：配置读取
- `src/lib/data-loader.js`：输入读取与校验
- `src/lib/xuexitong-client.js`：学习通章节创建主流程
- `data/chapters.example.json`：公开输入示例；复制为本机输入后配置
- `storage/state.json`：登录态缓存
- `logs/`：日志与截图

## 注意事项

1. 本工具会真实写入学习通，请先用单条任务验证。
2. 不绕过验证码、短信验证、滑块或权限控制。
3. 首次登录如出现验证码，需手动完成。
4. 章节复制依赖学习通编辑器当前行为，如果平台改版，需重新调整。

## 公开版本配置状态

- 公开版本不附带 `.env`；从 `.env.example` 复制后，仅在本机填写所需参数
- 公开版本不附带登录态；完成本人登录后，缓存仅保存在本机且不得提交
- 默认主入口改为 `run_chapter_create_workflow.sh`
