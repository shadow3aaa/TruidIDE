(() => {
  const promises = new Map();
  let seq = 0;

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const { id, ...data } = event.data;
    if (promises.has(id)) {
      const [resolve, reject] = promises.get(id);
      if (data.error) {
        reject(data.error);
      } else {
        resolve(data.payload);
      }
      promises.delete(id);
    }
  });

  function invoke(cmd, args) {
    return new Promise((resolve, reject) => {
      const id = seq++;
      promises.set(id, [resolve, reject]);
      window.parent.postMessage({ id, cmd, args }, '*');
    });
  }

  const truidApi = {
    toast: (text) => invoke('plugin:toast|toast', { text }),
  };

  async function showToast() {
    try {
      await truidApi.toast('来自预览项目的问候！');
    } catch (e) {
      console.error(e);
    }
  }

  window.truidApi = truidApi;
  window.showToast = showToast;
})();
