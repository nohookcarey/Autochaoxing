export const selectors = {
  login: {
    username:
      'input[name="uname"]:not([type="hidden"]), input[name="name"]:not([type="hidden"]), input[type="text"]:not([type="hidden"])',
    password: 'input[name="password"]:not([type="hidden"]), input[type="password"]:not([type="hidden"])',
    submit: 'button[type="submit"], .zl_btn_right, #loginBtn'
  },
  courseList: {
    card: ".course, .courseItem, li[courseid], .Mconright ul li",
    title: ".course-name, .courseName, .clazz-name, .content h3, .Mconright h3",
    link: "a"
  },
  chapterPage: {
    container: ".chapter, .catalog, .catalogList, .chapter-content"
  },
  chapterTree: {
    levelOneTitle:
      '.chapter_item[datalevel="1"] .posCatalog_name, .catalog_level1 .posCatalog_name, .level1 .posCatalog_name, .chapter_item .catalog_name',
    levelTwoTitle:
      '.chapter_item[datalevel="2"] .posCatalog_name, .catalog_level2 .posCatalog_name, .level2 .posCatalog_name',
    addChildButton:
      '.btn_add, .addChapter, .catalog_action_add, .fr .btnBlue, [title*="添加"], [aria-label*="添加"]',
    childInput: 'input[type="text"], textarea',
    childSaveButton: '.saveBtn, .btnBlue, .btn_sure, button:has-text("保存"), button:has-text("确定")'
  }
};
