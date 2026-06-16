// extract_pending_urls.js - Extract review-work URLs for pending students from mark pages
// Usage: via playwright_cli.sh run-code

const CONFIG = {
  assignments: [],
};

(async () => {
  const isBrowserClosedError = (error) => {
    const message = String(error?.message || error || '');
    return /Target page, context or browser has been closed/i.test(message)
      || /Browser has been closed/i.test(message)
      || /page\.goto:.*closed/i.test(message);
  };

  try {
  const results = [];
  
  for (const asgn of CONFIG.assignments) {
    console.log(`Navigating to: ${asgn.title} - ${asgn.className}`);
    await page.goto(asgn.markUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    
    // Extract pending student rows and their review-work URLs
    const pendingStudents = await page.evaluate(() => {
      const rows = [];
      // Find all rows in the mark table
      const trs = document.querySelectorAll('table tbody tr, .workList tbody tr, [class*="list"] tr');
      trs.forEach(tr => {
        const cells = tr.querySelectorAll('td');
        if (cells.length >= 4) {
          // Check if this row is "待批" (pending)
          const statusCell = cells[cells.length - 1] || cells[2];
          const statusText = statusCell ? statusCell.textContent.trim() : '';
          const hasPending = statusText.includes('待批') || statusText.includes('批阅');
          
          // Get the action link (批阅 button)
          const actionLink = tr.querySelector('a[href*="review-work"], a[href*="library/review"]');
          const nameCell = cells[1];
          const studentNoCell = cells[0];
          
          if (actionLink) {
            const href = actionLink.getAttribute('href') || actionLink.getAttribute('data-href') || '';
            // Check if this student is pending (score cell shows "待批" or is empty)
            const scoreCell = cells[cells.length - 2]; // Usually the score column
            const scoreText = scoreCell ? scoreCell.textContent.trim() : '';
            
            if (scoreText === '待批' || scoreText === '' || scoreText === '--' || !scoreText.match(/^\d/)) {
              rows.push({
                name: nameCell ? nameCell.textContent.trim() : '',
                studentNo: studentNoCell ? studentNoCell.textContent.trim() : '',
                reviewUrl: href.startsWith('http') ? href : 'https://mooc2-ans.chaoxing.com' + href,
                score: scoreText,
              });
            }
          }
        }
      });
      return rows;
    });
    
    if (pendingStudents.length > 0) {
      console.log(`  Found ${pendingStudents.length} pending students`);
      results.push({
        title: asgn.title,
        className: asgn.className,
        pendingStudents: pendingStudents,
      });
    } else {
      console.log(`  No pending students found (may need different selector)`);
      // Try alternative extraction - look at all links with review-work
      const altResults = await page.evaluate(() => {
        const links = [];
        document.querySelectorAll('a[href*="review-work"]').forEach(a => {
          const href = a.getAttribute('href') || '';
          const tr = a.closest('tr');
          const cells = tr ? tr.querySelectorAll('td') : [];
          links.push({
            href: href.startsWith('http') ? href : 'https://mooc2-ans.chaoxing.com' + href,
            rowText: tr ? tr.textContent.trim().substring(0, 200) : '',
          });
        });
        return links;
      });
      console.log(`  Alternative: found ${altResults.length} review-work links`);
      results.push({
        title: asgn.title,
        className: asgn.className,
        pendingStudents: [],
        altLinks: altResults,
      });
    }
  }
  
  console.log('===EXTRACT_RESULT===');
  console.log(JSON.stringify(results));
  } catch (error) {
    if (isBrowserClosedError(error)) {
      console.log(JSON.stringify({
        safeExit: true,
        status: 'manual_browser_exit',
        message: '浏览器已手动关闭，脚本已安全退出。',
      }));
      return;
    }
    throw error;
  }
})();
