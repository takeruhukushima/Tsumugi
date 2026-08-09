// Automatic posting was replaced by explicit browser-side sync. Keeping a
// small endpoint makes an existing deployment fail closed while its cron
// trigger is removed by the next Wrangler deployment.
export default {
  async fetch(): Promise<Response> {
    return new Response(
      "Tsumugiの自動投稿は廃止されました。ブラウザの「同期」ボタンを使用してください。",
      { status: 410 },
    );
  },
};
