/** Downscale an image file to max 720px on the long edge and return a JPEG data URL. */
export const shrinkImage = (file, maxEdge = 720, quality = 0.72) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = reject;
    r.onload = () => {
      const im = new Image();
      im.onerror = reject;
      im.onload = () => {
        const s = Math.min(1, maxEdge / Math.max(im.width, im.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(im.width * s);
        cv.height = Math.round(im.height * s);
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL('image/jpeg', quality));
      };
      im.src = r.result;
    };
    r.readAsDataURL(file);
  });
