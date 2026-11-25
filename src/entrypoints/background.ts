export default defineBackground(() => {
  // Opening an empty tab invokes the browser's default New Tab behavior cleanly with a focused address bar.
  browser.action.onClicked.addListener(() => {
    void browser.tabs.create({});
  });
});
