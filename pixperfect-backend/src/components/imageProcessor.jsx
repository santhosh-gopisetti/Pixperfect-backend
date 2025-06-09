self.onmessage = function (e) {
  const { imageSrc, operation, degrees, width, height } = e.data;

  // Validate input data
  if (!imageSrc || !operation || degrees === undefined || !width || !height) {
    self.postMessage({ error: 'Invalid input data.' });
    return;
  }

  // Initialize OffscreenCanvas with error handling
  let canvas;
  try {
    canvas = new OffscreenCanvas(width, height);
  } catch (err) {
    self.postMessage({ error: 'OffscreenCanvas not supported.' });
    return;
  }
  const ctx = canvas.getContext('2d');
  const img = new Image();

  img.onload = () => {
    const maxDimension = 400;
    let newWidth = img.width;
    let newHeight = img.height;
    if (newWidth > maxDimension || newHeight > maxDimension) {
      const ratio = Math.min(maxDimension / newWidth, maxDimension / newHeight);
      newWidth = Math.round(newWidth * ratio);
      newHeight = Math.round(newHeight * ratio);
    }
    const resizedCanvas = new OffscreenCanvas(newWidth, newHeight);
    const resizedCtx = resizedCanvas.getContext('2d');
    resizedCtx.drawImage(img, 0, 0, newWidth, newHeight);

    if (operation === 'rotate') {
      const angle = ((degrees % 360) + 360) % 360;
      const swapDimensions = angle === 90 || angle === 270;
      canvas.width = swapDimensions ? newHeight : newWidth;
      canvas.height = swapDimensions ? newWidth : newHeight;

      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((angle * Math.PI) / 180);
      ctx.drawImage(resizedCanvas, -newWidth / 2, -newHeight / 2);

      self.postMessage({
        rotatedDataUrl: canvas.toDataURL('image/png', 0.7),
      });
    } else if (operation === 'flip') {
      canvas.width = newWidth;
      canvas.height = newHeight;
      ctx.translate(degrees === 'horizontal' ? canvas.width : 0, degrees === 'vertical' ? canvas.height : 0);
      ctx.scale(degrees === 'horizontal' ? -1 : 1, degrees === 'vertical' ? -1 : 1);
      ctx.drawImage(resizedCanvas, 0, 0);

      self.postMessage({
        flippedDataUrl: canvas.toDataURL('image/png', 0.7),
      });
    } else {
      self.postMessage({ error: 'Unsupported operation.' });
    }
  };

  img.onerror = () => {
    self.postMessage({ error: 'Failed to process image.' });
  };

  img.src = imageSrc;
};