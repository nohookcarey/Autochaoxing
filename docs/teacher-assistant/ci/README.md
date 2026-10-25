# 待启用的自动检查模板

当前GitHub OAuth登录具有repo权限，但没有workflow权限；GitHub拒绝新增.github/workflows文件。本目录保留完整模板，本轮没有自动运行，也没有Linux/Windows/Mac远端验收结论。

由具备工作流权限的维护者将teacher-assistant.yml移入仓库根目录的.github/workflows/后，可对本模块启用Node 22三系统构建、测试、依赖审计及脱敏发布检查。Node检查不等于浏览器扩展或学校现场验收。
