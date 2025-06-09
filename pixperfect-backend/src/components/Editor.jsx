import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useLocation, useNavigate } from 'react-router-dom';
import Cropper from "cropperjs";
import "cropperjs/dist/cropper.css";
import axios from 'axios';
import { debounce, throttle } from 'lodash';
import "../App.css";

// Memoized CanvasWrapper (unchanged)
const CanvasWrapper = React.memo(({ editedImage, currentFilters, blendImage, blendMode, blendOpacity, textOverlay, drawingPaths, overlayImage, overlayProps, isDrawing, isOverlayActive, isLoading, handleMouseDown, handleMouseMove, handleMouseUp, canvasRef, previewCanvasRef, tempFilters }) => (
  <div className="canvas-wrapper">
    {isLoading && (
      <div className="loading-overlay">
        <span className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></span>
      </div>
    )}
    <canvas
      ref={canvasRef}
      className="main-canvas"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={{
        cursor: isDrawing
          ? "crosshair"
          : overlayProps.dragging || (isOverlayActive && overlayImage)
          ? "move"
          : textOverlay.dragging
          ? "move"
          : "default",
      }}
    />
    <canvas
      ref={previewCanvasRef}
      className="preview-canvas"
      style={{
        opacity: JSON.stringify(tempFilters) !== JSON.stringify(currentFilters) ? 1 : 0,
      }}
    />
  </div>
));

function Editor() {
  // State and refs (unchanged)
  const [image, setImage] = useState(null);
  const [editedImage, setEditedImage] = useState(null);
  const [blendImage, setBlendImage] = useState(null);
  const [blendMode, setBlendMode] = useState("normal");
  const [blendOpacity, setBlendOpacity] = useState(50);
  const [overlayImage, setOverlayImage] = useState(null);
  const [overlayProps, setOverlayProps] = useState({ x: 50, y: 50, scale: 1, opacity: 1.0, dragging: false, width: 100, height: 100 });
  const [isLoading, setIsLoading] = useState(false);
  const [isCropping, setIsCropping] = useState(false);
  const [cropRatio, setCropRatio] = useState(0);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isDragging, setIsDragging] = useState(false);
  const [isAddingText, setIsAddingText] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isOverlayActive, setIsOverlayActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [textOverlay, setTextOverlay] = useState({
    content: "",
    font: "Arial",
    size: 20,
    color: "#ffffff",
    x: 50,
    y: 50,
    opacity: 1.0,
    dragging: false,
  });
  const [drawingPaths, setDrawingPaths] = useState([]);
  const [currentPath, setCurrentPath] = useState(null);
  const [brushColor, setBrushColor] = useState("#ff0000");
  const [brushSize, setBrushSize] = useState(5);
  const [currentFilters, setCurrentFilters] = useState({
    brightness: 100,
    contrast: 100,
    saturation: 100,
    sepia: 0,
    grayscale: 0,
    blur: 0,
    hueRotate: 0,
    invert: 0,
  });
  const [tempFilters, setTempFilters] = useState({
    brightness: 100,
    contrast: 100,
    saturation: 100,
    sepia: 0,
    grayscale: 0,
    blur: 0,
    hueRotate: 0,
    invert: 0,
  });

  const imgRef = useRef(null);
  const cropperRef = useRef(null);
  const canvasRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const canvasContainerRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const blendInputRef = useRef(null);
  const overlayInputRef = useRef(null);
  const workerRef = useRef(null);

  const location = useLocation();
  const navigate = useNavigate();

  const blendModes = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "difference", "exclusion"];
  const availableFonts = ["Arial", "Times New Roman", "Georgia", "Roboto", "Helvetica", "Courier New"];
  const cropRatios = [
    { label: "Freeform", value: 0 },
    { label: "1:1 (Square)", value: 1 },
    { label: "4:3", value: 4 / 3 },
    { label: "16:9", value: 16 / 9 },
    { label: "3:2", value: 3 / 2 },
  ];

  // Initialize Web Worker (unchanged)
  useEffect(() => {
    try {
      workerRef.current = new Worker(new URL('./imageProcessor.js?worker', import.meta.url));
      workerRef.current.onerror = (err) => {
        console.error('Worker error:', err);
        setError('Failed to load image processing worker.');
      };
      return () => workerRef.current.terminate();
    } catch (err) {
      console.error('Failed to initialize worker:', err);
      setError('Failed to initialize image processing worker.');
    }
  }, []);

  // Initialize Cropper.js when isCropping changes
  useEffect(() => {
    if (isCropping && imgRef.current && editedImage) {
      console.log('Initializing Cropper.js with ratio:', cropRatio);
      try {
        // Destroy any existing cropper instance
        if (cropperRef.current) {
          cropperRef.current.destroy();
          cropperRef.current = null;
        }

        // Initialize Cropper.js
        cropperRef.current = new Cropper(imgRef.current, {
          aspectRatio: cropRatio || NaN, // Use NaN for freeform crop
          viewMode: 1, // Restrict crop box to image
          autoCropArea: 0.8, // Default crop area (80% of image)
          responsive: true,
          zoomable: true,
          scalable: true,
          movable: true,
          background: false,
          ready: () => {
            console.log('Cropper.js initialized successfully');
          },
        });
      } catch (err) {
        console.error('Failed to initialize Cropper.js:', err);
        setError('Failed to initialize cropping tool.');
        setIsCropping(false);
      }
    } else if (!isCropping && cropperRef.current) {
      console.log('Destroying Cropper.js');
      cropperRef.current.destroy();
      cropperRef.current = null;
    }

    // Cleanup on unmount
    return () => {
      if (cropperRef.current) {
        cropperRef.current.destroy();
        cropperRef.current = null;
      }
    };
  }, [isCropping, editedImage, cropRatio]);

  const resizeImage = useCallback((img, maxDimension = 400) => {
    let width = img.width;
    let height = img.height;
    if (width > maxDimension || height > maxDimension) {
      const ratio = Math.min(maxDimension / width, maxDimension / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, width, height);
    return canvas;
  }, []);

  const transformCoordinates = useMemo(() => (x, y, oldWidth, oldHeight, angle) => {
    const radians = (angle * Math.PI) / 180;
    const newX = x - oldWidth / 2;
    const newY = y - oldHeight / 2;
    const rotatedX = newX * Math.cos(radians) + newY * Math.sin(radians);
    const rotatedY = -newX * Math.sin(radians) + newY * Math.cos(radians);
    const swap = Math.abs(angle % 360) === 90 || Math.abs(angle % 360) === 270;
    const newWidth = swap ? oldHeight : oldWidth;
    const newHeight = swap ? oldWidth : oldHeight;
    return { x: rotatedX + newWidth / 2, y: rotatedY + newHeight / 2, newWidth, newHeight };
  }, []);

  // Image loading and initialization (unchanged)
  useEffect(() => {
    if (!location.state?.image) {
      setError('No image selected. Redirecting to images...');
      setTimeout(() => {
        navigate('/images', { replace: true });
      }, 2000);
      return;
    }

    const { imagePath, overlayProps: savedOverlayProps, textOverlay: savedTextOverlay } = location.state.image;
    if (!imagePath) {
      setError('Invalid image data. Redirecting to images...');
      setTimeout(() => {
        navigate('/images', { replace: true });
      }, 2000);
      return;
    }

    const imageUrl = `http://localhost:5001${imagePath}`;
    setIsLoading(true);
    setError(null);

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imageUrl;
    img.onload = () => {
      console.log('Image loaded successfully:', imageUrl);
      setEditedImage(imageUrl);
      setImage(imageUrl);
      let parsedOverlayProps = { x: 50, y: 50, scale: 1, opacity: 1.0, dragging: false, width: 100, height: 100 };
      if (savedOverlayProps) {
        try {
          parsedOverlayProps = JSON.parse(savedOverlayProps);
          parsedOverlayProps = {
            x: parsedOverlayProps.x ?? 50,
            y: parsedOverlayProps.y ?? 50,
            scale: parsedOverlayProps.scale ?? 1,
            opacity: parsedOverlayProps.opacity ?? 1.0,
            dragging: parsedOverlayProps.dragging ?? false,
            width: parsedOverlayProps.width ?? 100,
            height: parsedOverlayProps.height ?? 100,
          };
        } catch (err) {
          console.error('Failed to parse savedOverlayProps:', err);
          setError('Invalid overlay data. Using defaults.');
        }
      }
      setOverlayProps(parsedOverlayProps);
      let parsedTextOverlay = { content: "", font: "Arial", size: 20, color: "#ffffff", x: 50, y: 50, opacity: 1.0, dragging: false };
      if (savedTextOverlay) {
        try {
          parsedTextOverlay = JSON.parse(savedTextOverlay);
          parsedTextOverlay = {
            content: parsedTextOverlay.content ?? "",
            font: parsedTextOverlay.font ?? "Arial",
            size: parsedTextOverlay.size ?? 20,
            color: parsedTextOverlay.color ?? "#ffffff",
            x: parsedTextOverlay.x ?? 50,
            y: parsedTextOverlay.y ?? 50,
            opacity: parsedTextOverlay.opacity ?? 1.0,
            dragging: parsedTextOverlay.dragging ?? false,
          };
        } catch (err) {
          console.error('Failed to parse savedTextOverlay:', err);
          setError('Invalid text overlay data. Using defaults.');
        }
      }
      setTextOverlay(parsedTextOverlay);
      saveToHistory(imageUrl, currentFilters);
      setIsLoading(false);
    };
    img.onerror = () => {
      console.error('Failed to load image:', imageUrl);
      setError('Failed to load image. Redirecting to images...');
      setTimeout(() => {
        navigate('/images', { replace: true });
      }, 2000);
      setIsLoading(false);
    };
  }, [location.state, navigate]);

  // Modified drawCanvas (unchanged from original, included for completeness)
  const drawCanvas = useCallback(throttle((imgSrc, filters, blendImg = null, mode = "normal", opacity = 50, text = null, paths = [], overlay = null, overlayProps = { x: 50, y: 50, scale: 1, opacity: 1.0 }, targetCanvas = canvasRef.current) => {
    if (!targetCanvas || !canvasContainerRef.current) {
      console.error('drawCanvas: Invalid canvas or container', { targetCanvas, canvasContainer: canvasContainerRef.current });
      setError('Canvas not initialized.');
      setIsLoading(false);
      return;
    }

    const ctx = targetCanvas.getContext("2d");
    if (!ctx) {
      console.error('drawCanvas: Failed to get 2D context');
      setError('Canvas context not available.');
      setIsLoading(false);
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imgSrc;

    img.onload = () => {
      console.log('drawCanvas: Image loaded', { imgSrc, width: img.width, height: img.height });
      const resizedCanvas = resizeImage(img, 400);
      const container = canvasContainerRef.current;
      const containerWidth = container.clientWidth || 800;
      const containerHeight = container.clientHeight || 600;

      const imgAspectRatio = resizedCanvas.width / resizedCanvas.height;
      const containerAspectRatio = containerWidth / containerHeight;

      let displayWidth, displayHeight;
      if (imgAspectRatio > containerAspectRatio) {
        displayWidth = containerWidth;
        displayHeight = containerWidth / imgAspectRatio;
      } else {
        displayHeight = containerHeight;
        displayWidth = containerHeight * imgAspectRatio;
      }

      targetCanvas.width = resizedCanvas.width;
      targetCanvas.height = resizedCanvas.height;
      targetCanvas.style.width = `${displayWidth}px`;
      targetCanvas.style.height = `${displayHeight}px`;

      if (previewCanvasRef.current && targetCanvas === canvasRef.current) {
        previewCanvasRef.current.width = resizedCanvas.width;
        previewCanvasRef.current.height = resizedCanvas.height;
        previewCanvasRef.current.style.width = `${displayWidth}px`;
        previewCanvasRef.current.style.height = `${displayHeight}px`;
      }

      targetCanvas.style.margin = "auto";
      targetCanvas.style.display = "block";

      ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
      ctx.globalAlpha = 1.0;
      ctx.globalCompositeOperation = "source-over";
      ctx.filter = "none";

      ctx.filter = `
        brightness(${filters.brightness}%)
        contrast(${filters.contrast}%)
        saturate(${filters.saturation}%)
        sepia(${filters.sepia}%)
        grayscale(${filters.grayscale}%)
        blur(${filters.blur}px)
        hue-rotate(${filters.hueRotate}deg)
        invert(${filters.invert}%)
      `;
      ctx.drawImage(resizedCanvas, 0, 0, targetCanvas.width, targetCanvas.height);

      if (blendImg) {
        const blendImageObj = new Image();
        blendImageObj.crossOrigin = "anonymous";
        blendImageObj.onload = () => {
          console.log('drawCanvas: Blend image loaded', { blendImg, mode, opacity });
          const blendResized = resizeImage(blendImageObj, 400);
          ctx.globalAlpha = opacity / 100;
          ctx.globalCompositeOperation = mode;
          ctx.drawImage(blendResized, 0, 0, targetCanvas.width, targetCanvas.height);
          ctx.globalAlpha = 1.0;
          ctx.globalCompositeOperation = "source-over";
          if (text && text.content) drawText(ctx, text);
          drawPaths(ctx, paths);
          if (overlay && isOverlayActive) drawOverlay(ctx, overlay, overlayProps);
          console.log('drawCanvas: Rendering complete for main canvas');
          if (targetCanvas === canvasRef.current) setIsLoading(false);
        };
        blendImageObj.onerror = () => {
          console.error('drawCanvas: Failed to load blend image:', blendImg);
          setError('Failed to load blend image.');
          setIsLoading(false);
        };
        blendImageObj.src = blendImg;
      } else {
        if (text && text.content) drawText(ctx, text);
        drawPaths(ctx, paths);
        if (overlay && isOverlayActive) drawOverlay(ctx, overlay, overlayProps);
        console.log('drawCanvas: Rendering complete for main canvas (no blend)');
        if (targetCanvas === canvasRef.current) setIsLoading(false);
      }
    };

    img.onerror = () => {
      console.error('drawCanvas: Failed to load image:', imgSrc);
      setError("Failed to load the image.");
      setIsLoading(false);
    };
  }, 16), [resizeImage, isOverlayActive]);

  const drawText = (ctx, text) => {
    ctx.globalAlpha = text.opacity;
    ctx.font = `${text.size}px ${text.font}`;
    ctx.fillStyle = text.color;
    ctx.fillText(text.content, text.x, text.y);
    ctx.globalAlpha = 1.0;
  };

  const drawPaths = (ctx, paths) => {
    console.log('Drawing paths:', paths);
    ctx.save();
    ctx.globalAlpha = 1.0;
    ctx.globalCompositeOperation = 'source-over';
    paths.forEach((path) => {
      if (path.points.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = path.color;
      ctx.lineWidth = path.size;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.moveTo(path.points[0].x, path.points[0].y);
      for (let i = 1; i < path.points.length; i++) {
        ctx.lineTo(path.points[i].x, path.points[i].y);
      }
      ctx.stroke();
    });
    ctx.restore();
  };

  const drawOverlay = (ctx, overlaySrc, { x, y, scale, opacity, width, height }) => {
    const overlayImg = new Image();
    overlayImg.crossOrigin = "anonymous";
    overlayImg.onload = () => {
      console.log('Drawing overlay at:', { x, y, scale, opacity, width, height });
      const overlayResized = resizeImage(overlayImg, 400);
      const renderWidth = (width || overlayResized.width) * scale;
      const renderHeight = (height || overlayResized.height) * scale;
      ctx.globalAlpha = opacity;
      ctx.drawImage(overlayResized, x - renderWidth / 2, y - renderHeight / 2, renderWidth, renderHeight);
      ctx.globalAlpha = 1.0;
    };
    overlayImg.onerror = () => {
      console.error('Failed to load overlay image:', overlaySrc);
      setError('Failed to load overlay image.');
    };
    overlayImg.src = overlaySrc;
  };

  const saveToHistory = (imgSrc, filters, blendImg = null, mode = "normal", opacity = 50, text = null, paths = [], overlay = null, overlayProps = { x: 50, y: 50, scale: 1, opacity: 1.0, dragging: false, width: 100, height: 100 }) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ image: imgSrc, filters, blendImage: blendImg, blendMode: mode, blendOpacity: opacity, textOverlay: text, drawingPaths: paths, overlayImage: overlay, overlayProps });
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const handleImageUpload = (file) => {
    if (!file) return;

    setIsLoading(true);
    setError(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const dataUrl = e.target.result;
        console.log('Image uploaded:', dataUrl.substring(0, 50));
        const defaults = {
          brightness: 100,
          contrast: 100,
          saturation: 100,
          sepia: 0,
          grayscale: 0,
          blur: 0,
          hueRotate: 0,
          invert: 0,
        };

        setImage(dataUrl);
        setEditedImage(dataUrl);
        setCurrentFilters(defaults);
        setTempFilters(defaults);
        setBlendImage(null);
        setOverlayImage(null);
        setOverlayProps({ x: 50, y: 50, scale: 1, opacity: 1.0, dragging: false, width: 100, height: 100 });
        setTextOverlay({ content: "", font: "Arial", size: 20, color: "#ffffff", x: 50, y: 50, opacity: 1.0, dragging: false });
        setDrawingPaths([]);
        saveToHistory(dataUrl, defaults);
      } catch (err) {
        console.error('Failed to process uploaded image:', err);
        setError("Failed to process the image.");
      } finally {
        setIsLoading(false);
      }
    };

    reader.onerror = () => {
      console.error('Failed to read image file');
      setError("Failed to read the image file.");
      setIsLoading(false);
    };

    reader.readAsDataURL(file);
  };

  const handleBlendImageUpload = (file) => {
    if (!file) return;

    setIsLoading(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      const blendDataUrl = e.target.result;
      console.log('Blend image loaded:', blendDataUrl.substring(0, 50));
      setBlendImage(blendDataUrl);
      drawCanvas(editedImage, currentFilters, blendDataUrl, blendMode, blendOpacity, textOverlay, drawingPaths, overlayImage, overlayProps);
      saveToHistory(editedImage, currentFilters, blendDataUrl, blendMode, blendOpacity, textOverlay, drawingPaths, overlayImage, overlayProps);
      setIsLoading(false);
    };
    reader.onerror = () => {
      console.error('Failed to load blend image');
      setError("Failed to load blend image.");
      setIsLoading(false);
    };
    reader.readAsDataURL(file);
  };

  const handleOverlayImageUpload = (file) => {
    if (!file) return;

    setIsLoading(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      const overlayDataUrl = e.target.result;
      const centerX = canvasRef.current?.width / 2 || 50;
      const centerY = canvasRef.current?.height / 2 || 50;
      const img = new Image();
      img.onload = () => {
        const resized = resizeImage(img, 400);
        console.log('Overlay image loaded:', overlayDataUrl.substring(0, 50));
        setOverlayImage(overlayDataUrl);
        setOverlayProps({ x: centerX, y: centerY, scale: 1, opacity: 1.0, dragging: false, width: resized.width, height: resized.height });
        setIsOverlayActive(true);
        drawCanvas(editedImage, currentFilters, blendImage, blendMode, blendOpacity, textOverlay, drawingPaths, overlayDataUrl, { x: centerX, y: centerY, scale: 1, opacity: 1.0, width: resized.width, height: resized.height });
        saveToHistory(editedImage, currentFilters, blendImage, blendMode, blendOpacity, textOverlay, drawingPaths, overlayDataUrl, { x: centerX, y: centerY, scale: 1, opacity: 1.0, width: resized.width, height: resized.height });
        setIsLoading(false);
      };
      img.onerror = () => {
        console.error('Failed to load overlay image');
        setError('Failed to load overlay image.');
        setIsLoading(false);
      };
      img.src = overlayDataUrl;
    };
    reader.onerror = () => {
      console.error('Failed to load overlay image file');
      setError("Failed to load overlay image.");
      setIsLoading(false);
    };
    reader.readAsDataURL(file);
  };

  const rotateImage = useCallback(async (degrees) => {
    if (!editedImage) {
      setError("No image to rotate.");
      return;
    }

    if (isProcessing) return;

    setIsProcessing(true);
    setIsLoading(true);

    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = editedImage;
      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image for rotation'));
      });

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const resized = resizeImage(img, 400);

      const swap = Math.abs(degrees % 360) === 90 || Math.abs(degrees % 360) === 270;
      canvas.width = swap ? resized.height : resized.width;
      canvas.height = swap ? resized.width : resized.height;

      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((degrees * Math.PI) / 180);
      ctx.drawImage(resized, -resized.width / 2, -resized.height / 2);
      ctx.restore();

      const rotatedDataUrl = canvas.toDataURL("image/png");

      const newTextCoords = transformCoordinates(
        textOverlay.x,
        textOverlay.y,
        resized.width,
        resized.height,
        degrees
      );
      const newOverlayCoords = transformCoordinates(
        overlayProps.x,
        overlayProps.y,
        resized.width,
        resized.height,
        degrees
      );

      setEditedImage(rotatedDataUrl);
      setDrawingPaths([]);
      setOverlayImage(null);
      setOverlayProps({
        x: newOverlayCoords.x,
        y: newOverlayCoords.y,
        scale: 1,
        opacity: 1.0,
        dragging: false,
        width: newOverlayCoords.newWidth,
        height: newOverlayCoords.newHeight,
      });
      setTextOverlay({
        ...textOverlay,
        x: newTextCoords.x,
        y: newTextCoords.y,
        dragging: false,
      });

      saveToHistory(
        rotatedDataUrl,
        currentFilters,
        blendImage,
        blendMode,
        blendOpacity,
        { ...textOverlay, x: newTextCoords.x, y: newTextCoords.y, dragging: false },
        [],
        null,
        {
          x: newOverlayCoords.x,
          y: newOverlayCoords.y,
          scale: 1,
          opacity: 1.0,
          dragging: false,
          width: newOverlayCoords.newWidth,
          height: newOverlayCoords.newHeight,
        }
      );

      setIsLoading(false);
      setIsProcessing(false);
    } catch (err) {
      console.error('Failed to rotate image:', err);
      setError('Failed to rotate image: ' + err.message);
      setIsLoading(false);
      setIsProcessing(false);
    }
  }, [editedImage, currentFilters, blendImage, blendMode, blendOpacity, textOverlay, overlayProps, resizeImage, transformCoordinates]);

  const flipImage = useCallback(async (direction) => {
    if (!editedImage) {
      setError("No image to flip.");
      return;
    }

    if (isProcessing) return;

    setIsProcessing(true);
    setIsLoading(true);

    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = editedImage;
      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image for flipping'));
      });

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const resized = resizeImage(img, 400);

      canvas.width = resized.width;
      canvas.height = resized.height;

      ctx.save();
      if (direction === 'horizontal') {
        ctx.scale(-1, 1);
        ctx.drawImage(resized, -resized.width, 0);
      } else if (direction === 'vertical') {
        ctx.scale(1, -1);
        ctx.drawImage(resized, 0, -resized.height);
      }
      ctx.restore();

      const flippedDataUrl = canvas.toDataURL("image/png");

      let newTextX = textOverlay.x;
      let newTextY = textOverlay.y;
      let newOverlayX = overlayProps.x;
      let newOverlayY = overlayProps.y;

      if (direction === 'horizontal') {
        newTextX = canvas.width - textOverlay.x;
        newOverlayX = canvas.width - overlayProps.x;
      } else if (direction === 'vertical') {
        newTextY = canvas.height - textOverlay.y;
        newOverlayY = canvas.height - overlayProps.y;
      }

      setEditedImage(flippedDataUrl);
      setDrawingPaths([]);
      setOverlayImage(null);
      setOverlayProps({
        x: newOverlayX,
        y: newOverlayY,
        scale: 1,
        opacity: 1.0,
        dragging: false,
        width: overlayProps.width,
        height: overlayProps.height,
      });
      setTextOverlay({
        ...textOverlay,
        x: newTextX,
        y: newTextY,
        dragging: false,
      });

      saveToHistory(
        flippedDataUrl,
        currentFilters,
        blendImage,
        blendMode,
        blendOpacity,
        { ...textOverlay, x: newTextX, y: newTextY, dragging: false },
        [],
        null,
        {
          x: newOverlayX,
          y: newOverlayY,
          scale: 1,
          opacity: 1.0,
          dragging: false,
          width: overlayProps.width,
          height: overlayProps.height,
        }
      );

      setIsLoading(false);
      setIsProcessing(false);
    } catch (err) {
      console.error('Failed to flip image:', err);
      setError('Failed to flip image: ' + err.message);
      setIsLoading(false);
      setIsProcessing(false);
    }
  }, [editedImage, currentFilters, blendImage, blendMode, blendOpacity, textOverlay, overlayProps, resizeImage]);

  // Modified handleCrop function
  const handleCrop = useCallback(() => {
    if (!cropperRef.current || !imgRef.current) {
      console.error('handleCrop: Cropper or image not initialized');
      setError('Cropper or image not initialized.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const cropCanvas = cropperRef.current.getCroppedCanvas({
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
      });

      if (!cropCanvas) {
        console.error('handleCrop: Failed to get cropped canvas');
        setError('Failed to crop image: No cropped area selected.');
        setIsLoading(false);
        return;
      }

      const croppedDataUrl = cropCanvas.toDataURL("image/png");
      console.log('Cropped image generated:', croppedDataUrl.substring(0, 50));

      // Update canvas dimensions to match cropped image
      if (canvasRef.current) {
        canvasRef.current.width = cropCanvas.width;
        canvasRef.current.height = cropCanvas.height;
      }

      // Update states
      setEditedImage(croppedDataUrl);
      setImage(croppedDataUrl);
      setDrawingPaths([]);
      setOverlayImage(null);
      setOverlayProps({ x: cropCanvas.width / 2, y: cropCanvas.height / 2, scale: 1, opacity: 1.0, dragging: false, width: 100, height: 100 });
      setTextOverlay({ ...textOverlay, x: cropCanvas.width / 2, y: cropCanvas.height / 2, dragging: false });
      
      // Save to history
      saveToHistory(
        croppedDataUrl,
        currentFilters,
        blendImage,
        blendMode,
        blendOpacity,
        { ...textOverlay, x: cropCanvas.width / 2, y: cropCanvas.height / 2, dragging: false },
        [],
        null,
        { x: cropCanvas.width / 2, y: cropCanvas.height / 2, scale: 1, opacity: 1.0, dragging: false, width: 100, height: 100 }
      );

      // Destroy cropper and exit crop mode
      cropperRef.current.destroy();
      cropperRef.current = null;
      setIsCropping(false);
      setIsLoading(false);
      console.log('Crop applied successfully');
    } catch (err) {
      console.error('Failed to crop image:', err);
      setError('Failed to crop image: ' + err.message);
      setIsLoading(false);
      if (cropperRef.current) {
        cropperRef.current.destroy();
        cropperRef.current = null;
      }
      setIsCropping(false);
    }
  }, [currentFilters, blendImage, blendMode, blendOpacity, textOverlay]);

  const handleDownload = async () => {
    if (!canvasRef.current) {
      console.error("Download failed: Canvas reference is null.");
      setError("No image to download: Canvas not initialized.");
      return;
    }

    const canvas = canvasRef.current;

    if (canvas.width === 0 || canvas.height === 0) {
      console.error("Download failed: Canvas has zero dimensions", { width: canvas.width, height: canvas.height });
      setError("Canvas is empty or not initialized.");
      return;
    }

    try {
      const testDataUrl = canvas.toDataURL("image/png");
      if (!testDataUrl || testDataUrl === "data:,") {
        console.warn("Canvas is empty. Attempting to redraw...");
        setIsLoading(true);
        await new Promise((resolve) => {
          drawCanvas(
            editedImage,
            currentFilters,
            blendImage,
            blendMode,
            blendOpacity,
            textOverlay,
            drawingPaths,
            overlayImage,
            overlayProps,
            canvas
          );
          setTimeout(resolve, 100); // Small delay to ensure rendering
        });
        setIsLoading(false);
      }

      const dataUrl = canvas.toDataURL("image/png");
      if (!dataUrl || dataUrl === "data:,") {
        console.error("Download failed: Invalid or empty data URL after redraw.");
        throw new Error("Canvas produced an invalid data URL.");
      }

      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = "edited-image.png";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      console.log("Image downloaded successfully: edited-image.png");
    } catch (err) {
      console.error("Failed to download image:", err);
      if (err.name === "SecurityError") {
        setError("Cannot download: Image source is from a different origin (CORS issue). Ensure images are local or have proper CORS headers.");
      } else {
        setError("Failed to download image: " + err.message);
      }
    }
  };

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    handleImageUpload(file);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    handleImageUpload(file);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const toggleCropper = () => {
    setIsCropping((prev) => {
      console.log('Crop mode:', !prev);
      return !prev;
    });
    setIsDrawing(false);
    setIsAddingText(false);
    setIsOverlayActive(false);
  };

  const debouncedRotate = useCallback(debounce((degrees) => rotateImage(degrees), 1000), [rotateImage]);
  const debouncedFlip = useCallback(debounce((direction) => flipImage(direction), 1000), [flipImage]);

  const handleUndo = () => {
    if (historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    const { image, filters, blendImage: historyBlendImage, blendMode: historyBlendMode, blendOpacity: historyBlendOpacity, textOverlay: historyText, drawingPaths: historyPaths, overlayImage: historyOverlay, overlayProps: historyOverlayProps } = history[newIndex];
    setEditedImage(image);
    setCurrentFilters({ ...filters });
    setTempFilters({ ...filters });
    setBlendImage(historyBlendImage);
    setBlendMode(historyBlendMode);
    setBlendOpacity(historyBlendOpacity);
    setTextOverlay(historyText || { content: "", font: "Arial", size: 20, color: "#ffffff", x: 50, y: 50, opacity: 1.0, dragging: false });
    setDrawingPaths(historyPaths || []);
    setOverlayImage(historyOverlay);
    setOverlayProps(historyOverlayProps || { x: 50, y: 50, scale: 1, opacity: 1.0, dragging: false, width: 100, height: 100 });
    setIsOverlayActive(!!historyOverlay);
    drawCanvas(image, filters, historyBlendImage, historyBlendMode, historyBlendOpacity, historyText, historyPaths || [], historyOverlay, historyOverlayProps || { x: 50, y: 50, scale: 1, opacity: 1.0, width: 100, height: 100 });
  };

  const handleRedo = () => {
    if (historyIndex >= history.length - 1) return;
    const newIndex = historyIndex + 1;
    setHistoryIndex(newIndex);
    const { image, filters, blendImage: historyBlendImage, blendMode: historyBlendMode, blendOpacity: historyBlendOpacity, textOverlay: historyText, drawingPaths: historyPaths, overlayImage: historyOverlay, overlayProps: historyOverlayProps } = history[newIndex];
    setEditedImage(image);
    setCurrentFilters({ ...filters });
    setTempFilters({ ...filters });
    setBlendImage(historyBlendImage);
    setBlendMode(historyBlendMode);
    setBlendOpacity(historyBlendOpacity);
    setTextOverlay(historyText || { content: "", font: "Arial", size: 20, color: "#ffffff", x: 50, y: 50, opacity: 1.0, dragging: false });
    setDrawingPaths(historyPaths || []);
    setOverlayImage(historyOverlay);
    setOverlayProps(historyOverlayProps || { x: 50, y: 50, scale: 1, opacity: 1.0, dragging: false, width: 100, height: 100 });
    setIsOverlayActive(!!historyOverlay);
    drawCanvas(image, filters, historyBlendImage, historyBlendMode, historyBlendOpacity, historyText, historyPaths || [], historyOverlay, historyOverlayProps || { x: 50, y: 50, scale: 1, opacity: 1.0, width: 100, height: 100 });
  };

  const applyPreset = (preset) => {
    let newFilters;
    switch (preset) {
      case "grayscale":
        newFilters = { ...currentFilters, grayscale: 100, saturation: 0 };
        break;
      case "sepia":
        newFilters = { ...currentFilters, sepia: 80, saturation: 110, contrast: 110 };
        break;
      case "vivid":
        newFilters = { ...currentFilters, saturation: 150, contrast: 120, brightness: 110 };
        break;
      case "vintage":
        newFilters = { ...currentFilters, sepia: 30, contrast: 120, brightness: 90, hueRotate: 30 };
        break;
      case "cool":
        newFilters = { ...currentFilters, hueRotate: 180, brightness: 105 };
        break;
      case "warm":
        newFilters = { ...currentFilters, hueRotate: 30, brightness: 105, saturation: 120 };
        break;
      default:
        return;
    }
    setTempFilters(newFilters);
    setCurrentFilters(newFilters);
    handleApplyFilters(newFilters);
  };

  const debouncedFilterPreview = useCallback((filters) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      if (editedImage && previewCanvasRef.current) {
        drawCanvas(editedImage, filters, blendImage, blendMode, blendOpacity, textOverlay, drawingPaths, overlayImage, overlayProps, previewCanvasRef.current);
      }
    }, 50);
  }, [editedImage, blendImage, blendMode, blendOpacity, textOverlay, drawingPaths, overlayImage, overlayProps, drawCanvas]);

  useEffect(() => {
    if (editedImage) {
      debouncedFilterPreview(tempFilters);
    }
  }, [editedImage, tempFilters, debouncedFilterPreview]);

  useEffect(() => {
    if (editedImage && canvasRef.current) {
      console.log('Triggering drawCanvas with:', { editedImage: editedImage.substring(0, 50), blendImage: blendImage?.substring(0, 50), blendMode, blendOpacity });
      drawCanvas(editedImage, currentFilters, blendImage, blendMode, blendOpacity, textOverlay, drawingPaths, overlayImage, overlayProps);
    }
  }, [editedImage, currentFilters, blendImage, blendMode, blendOpacity, textOverlay, drawingPaths, overlayImage, overlayProps, drawCanvas]);

  const handleApplyFilters = (filtersToApply = tempFilters) => {
    setIsLoading(true);
    setCurrentFilters({ ...filtersToApply });

    const tempCanvas = document.createElement("canvas");
    const img = new Image();

    img.onload = () => {
      const resizedCanvas = resizeImage(img, 400);
      tempCanvas.width = resizedCanvas.width;
      tempCanvas.height = resizedCanvas.height;
      const ctx = tempCanvas.getContext("2d");

      ctx.filter = `
        brightness(${filtersToApply.brightness}%)
        contrast(${filtersToApply.contrast}%)
        saturate(${filtersToApply.saturation}%)
        sepia(${filtersToApply.sepia}%)
        grayscale(${filtersToApply.grayscale}%)
        blur(${filtersToApply.blur}px)
        hue-rotate(${filtersToApply.hueRotate}deg)
        invert(${filtersToApply.invert}%)
      `;
      ctx.drawImage(resizedCanvas, 0, 0);

      if (blendImage) {
        const blendImg = new Image();
        blendImg.onload = () => {
          const blendResized = resizeImage(blendImg, 400);
          ctx.globalAlpha = blendOpacity / 100;
          ctx.globalCompositeOperation = blendMode;
          ctx.drawImage(blendResized, 0, 0, tempCanvas.width, tempCanvas.height);
          ctx.globalAlpha = 1.0;
          ctx.globalCompositeOperation = "source-over";

          if (textOverlay && textOverlay.content) drawText(ctx, textOverlay);
          drawPaths(ctx, drawingPaths);
          if (overlayImage && isOverlayActive) drawOverlay(ctx, overlayImage, overlayProps);

          const filteredDataUrl = tempCanvas.toDataURL("image/png");
          setEditedImage(filteredDataUrl);
          saveToHistory(filteredDataUrl, filtersToApply, blendImage, blendMode, blendOpacity, textOverlay, drawingPaths, overlayImage, overlayProps);
          setIsLoading(false);
        };
        blendImg.onerror = () => {
          setError("Failed to load blend image.");
          setIsLoading(false);
        };
        blendImg.src = blendImage;
      } else {
        if (textOverlay && textOverlay.content) drawText(ctx, textOverlay);
        drawPaths(ctx, drawingPaths);
        if (overlayImage && isOverlayActive) drawOverlay(ctx, overlayImage, overlayProps);

        const filteredDataUrl = tempCanvas.toDataURL("image/png");
        setEditedImage(filteredDataUrl);
        saveToHistory(filteredDataUrl, filtersToApply, blendImage, blendMode, blendOpacity, textOverlay, drawingPaths, overlayImage, overlayProps);
        setIsLoading(false);
      }
    };

    img.onerror = () => {
      setError("Failed to load image for filtering.");
      setIsLoading(false);
    };

    img.src = editedImage;
  };

  const toggleTextMode = () => {
    setIsAddingText((prev) => {
      console.log('Text mode:', !prev);
      return !prev;
    });
    setIsDrawing(false);
    setIsOverlayActive(false);
  };

  const toggleOverlayMode = () => {
    if (overlayImage) {
      setIsOverlayActive((prev) => {
        console.log('Overlay mode:', !prev);
        return !prev;
      });
      setIsDrawing(false);
      setIsAddingText(false);
    }
  };

  const toggleDrawingMode = () => {
    setIsDrawing((prev) => {
      console.log('Drawing mode:', !prev);
      return !prev;
    });
    setIsAddingText(false);
    setIsOverlayActive(false);
  };

  const handleMouseDown = (e) => {
    if (!canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvasRef.current.width / rect.width);
    const y = (e.clientY - rect.top) * (canvasRef.current.height / rect.height);
    console.log('MouseDown:', { x, y, canvasWidth: canvasRef.current.width, canvasHeight: canvasRef.current.height });

    if (isDrawing) {
      setCurrentPath({ points: [{ x, y }], color: brushColor, size: brushSize });
    } else if (isAddingText && textOverlay.content) {
      setTextOverlay({ ...textOverlay, x, y, dragging: true });
    } else if (isOverlayActive && overlayImage) {
      const overlayWidth = (overlayProps.width || 100) * overlayProps.scale;
      const overlayHeight = (overlayProps.height || 100) * overlayProps.scale;
      if (
        x >= overlayProps.x - overlayWidth / 2 &&
        x <= overlayProps.x + overlayWidth / 2 &&
        y >= overlayProps.y - overlayHeight / 2 &&
        y <= overlayProps.y + overlayHeight / 2
      ) {
        setOverlayProps({ ...overlayProps, dragging: true });
      }
    }
  };

  const handleMouseMove = (e) => {
    if (!canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvasRef.current.width / rect.width);
    const y = (e.clientY - rect.top) * (canvasRef.current.height / rect.height);
    console.log('MouseMove:', { x, y });

    if (isDrawing && currentPath) {
      const newPath = { ...currentPath, points: [...currentPath.points, { x, y }] };
      setCurrentPath(newPath);
      drawCanvas(editedImage, currentFilters, blendImage, blendMode, blendOpacity, textOverlay, [...drawingPaths.filter(p => p !== currentPath), newPath], overlayImage, overlayProps);
    } else if (textOverlay.dragging) {
      setTextOverlay({ ...textOverlay, x, y });
      drawCanvas(editedImage, currentFilters, blendImage, blendMode, blendOpacity, { ...textOverlay, x, y }, drawingPaths, overlayImage, overlayProps);
    } else if (overlayProps.dragging) {
      setOverlayProps({ ...overlayProps, x, y });
      drawCanvas(editedImage, currentFilters, blendImage, blendMode, blendOpacity, textOverlay, drawingPaths, overlayImage, { ...overlayProps, x, y });
    }
  };

  const handleMouseUp = () => {
    if (isDrawing && currentPath) {
      setDrawingPaths((prev) => [...prev, currentPath]);
      setCurrentPath(null);
      saveToHistory(editedImage, currentFilters, blendImage, blendMode, blendOpacity, textOverlay, [...drawingPaths, currentPath], overlayImage, overlayProps);
    } else if (textOverlay.dragging) {
      setTextOverlay({ ...textOverlay, dragging: false });
      saveToHistory(editedImage, currentFilters, blendImage, blendMode, blendOpacity, textOverlay, drawingPaths, overlayImage, overlayProps);
    } else if (overlayProps.dragging) {
      setOverlayProps({ ...overlayProps, dragging: false });
      saveToHistory(editedImage, currentFilters, blendImage, blendMode, blendOpacity, textOverlay, drawingPaths, overlayImage, overlayProps);
    }
  };

  const handleSave = async () => {
    if (!canvasRef.current) return;

    setIsLoading(true);
    try {
      const canvas = canvasRef.current;
      const dataUrl = canvas.toDataURL("image/png");
      const blob = await fetch(dataUrl).then((res) => res.blob());
      const file = new File([blob], "edited-image.png", { type: "image/png" });

      const formData = new FormData();
      formData.append("image", file);
      const completeOverlayProps = {
        x: overlayProps.x ?? 50,
        y: overlayProps.y ?? 50,
        scale: overlayProps.scale ?? 1,
        opacity: overlayProps.opacity ?? 1.0,
        dragging: overlayProps.dragging ?? false,
        width: overlayProps.width ?? 100,
        height: overlayProps.height ?? 100,
      };
      formData.append("overlayProps", JSON.stringify(completeOverlayProps));
      const completeTextOverlay = {
        content: textOverlay.content ?? "",
        font: textOverlay.font ?? "Arial",
        size: textOverlay.size ?? 20,
        color: textOverlay.color ?? "#ffffff",
        x: textOverlay.x ?? 50,
        y: textOverlay.y ?? 50,
        opacity: textOverlay.opacity ?? 1.0,
        dragging: textOverlay.dragging ?? false,
      };
      formData.append("textOverlay", JSON.stringify(completeTextOverlay));

      const token = localStorage.getItem("token");
      const response = await axios.post("http://localhost:5001/upload", formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "multipart/form-data",
        },
      });

      setIsLoading(false);
      navigate("/images");
    } catch (err) {
      console.error('Failed to save image:', err);
      setError("Failed to save image.");
      setIsLoading(false);
    }
  };

  const handleBlendImageClick = () => {
    if (blendInputRef.current) {
      blendInputRef.current.click();
    }
  };

  const handleOverlayImageClick = () => {
    if (overlayInputRef.current) {
      overlayInputRef.current.click();
    }
  };

  return (
    <div className="editor-layout">
      {error && <div className="error-message">{error}</div>}
      <main className="editor-main">
        <aside className="left-sidebar">
          <div className="panel-content">
            <div className="toolbar">
              <h4>Tools</h4>
              <div className="tool-button">
                <input type="file" accept="image/*" onChange={handleFileChange} />
                Upload Image
              </div>
              <button onClick={() => debouncedRotate(90)} disabled={isProcessing || isLoading}>
                Rotate 90°
              </button>
              <button onClick={() => debouncedRotate(-90)} disabled={isProcessing || isLoading}>
                Rotate -90°
              </button>
              <button onClick={() => debouncedFlip('horizontal')} disabled={isProcessing || isLoading}>
                Flip Horizontal
              </button>
              <button onClick={() => debouncedFlip('vertical')} disabled={isProcessing || isLoading}>
                Flip Vertical
              </button>
              <button onClick={toggleCropper} disabled={isLoading || !editedImage}>
                {isCropping ? "Cancel Crop" : "Crop"}
              </button>
              <select
                value={cropRatio}
                onChange={(e) => setCropRatio(parseFloat(e.target.value))}
                disabled={!isCropping}
              >
                {cropRatios.map((ratio) => (
                  <option key={ratio.value} value={ratio.value}>
                    {ratio.label}
                  </option>
                ))}
              </select>
              <button onClick={handleCrop} disabled={!isCropping || isLoading}>
                Apply Crop
              </button>
              <button onClick={handleUndo} disabled={historyIndex <= 0}>
                Undo
              </button>
              <button onClick={handleRedo} disabled={historyIndex >= history.length - 1}>
                Redo
              </button>
            </div>

            <div className="blending-controls">
              <h4>Blending</h4>
              <input
                type="file"
                accept="image/*"
                ref={blendInputRef}
                onChange={(e) => handleBlendImageUpload(e.target.files[0])}
                style={{ display: 'none' }}
              />
              <button
                className="tool-button"
                onClick={handleBlendImageClick}
                disabled={isLoading}
              >
                Choose Blend Image
              </button>
              <select value={blendMode} onChange={(e) => setBlendMode(e.target.value)}>
                {blendModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
              <label className="control-label">Opacity: {blendOpacity}%</label>
              <input
                type="range"
                min="0"
                max="100"
                value={blendOpacity}
                onChange={(e) => setBlendOpacity(parseInt(e.target.value))}
              />
            </div>

            <div className="overlay-controls">
              <h4>Overlay</h4>
              <input
                type="file"
                accept="image/*"
                ref={overlayInputRef}
                onChange={(e) => handleOverlayImageUpload(e.target.files[0])}
                style={{ display: 'none' }}
              />
              <button
                className="tool-button"
                onClick={handleOverlayImageClick}
                disabled={isLoading}
              >
                Choose Overlay Image
              </button>
              <label className="control-label">Scale: {(overlayProps.scale ?? 1).toFixed(1)}</label>
              <input
                type="range"
                min="0.1"
                max="2"
                step="0.1"
                value={overlayProps.scale ?? 1}
                onChange={(e) => setOverlayProps({ ...overlayProps, scale: parseFloat(e.target.value) })}
                disabled={!overlayImage}
              />
              <label className="control-label">Opacity: {(overlayProps.opacity ?? 1).toFixed(1)}</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={overlayProps.opacity ?? 1}
                onChange={(e) => setOverlayProps({ ...overlayProps, opacity: parseFloat(e.target.value) })}
                disabled={!overlayImage}
              />
              <button onClick={toggleOverlayMode} disabled={!overlayImage} className={isOverlayActive ? "active" : ""}>
                {isOverlayActive ? "Disable Overlay" : "Enable Overlay"}
              </button>
            </div>

            <div className="text-controls">
              <h4>Text</h4>
              <input
                type="text"
                value={textOverlay.content}
                onChange={(e) => setTextOverlay({ ...textOverlay, content: e.target.value })}
                placeholder="Enter text"
              />
              <select
                value={textOverlay.font}
                onChange={(e) => setTextOverlay({ ...textOverlay, font: e.target.value })}
              >
                {availableFonts.map((font) => (
                  <option key={font} value={font}>
                    {font}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="10"
                max="100"
                value={textOverlay.size}
                onChange={(e) => setTextOverlay({ ...textOverlay, size: parseInt(e.target.value) })}
              />
              <input
                type="color"
                value={textOverlay.color}
                onChange={(e) => setTextOverlay({ ...textOverlay, color: e.target.value })}
              />
              <label className="control-label">Opacity: {textOverlay.opacity.toFixed(1)}</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={textOverlay.opacity}
                onChange={(e) => setTextOverlay({ ...textOverlay, opacity: parseFloat(e.target.value) })}
              />
              <button onClick={toggleTextMode} className={isAddingText ? "active" : ""}>
                {isAddingText ? "Stop Adding Text" : "Add Text"}
              </button>
            </div>

            <div className="drawing-controls">
              <h4>Draw</h4>
              <input
                type="color"
                value={brushColor}
                onChange={(e) => setBrushColor(e.target.value)}
              />
              <label className="control-label">Brush Size: {brushSize}px</label>
              <input
                type="range"
                min="1"
                max="20"
                value={brushSize}
                onChange={(e) => setBrushSize(parseInt(e.target.value))}
              />
              <button onClick={toggleDrawingMode} className={isDrawing ? "active" : ""}>
                {isDrawing ? "Stop Drawing" : "Draw"}
              </button>
            </div>
          </div>
        </aside>

        <div className="main-content">
          <div
            className={`canvas-container ${isDragging ? 'drag-over' : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            ref={canvasContainerRef}
          >
            {isCropping ? (
              <img ref={imgRef} src={editedImage} alt="Crop" style={{ display: 'block', maxWidth: '100%', maxHeight: '100%' }} />
            ) : (
              <CanvasWrapper
                editedImage={editedImage}
                currentFilters={currentFilters}
                blendImage={blendImage}
                blendMode={blendMode}
                blendOpacity={blendOpacity}
                textOverlay={textOverlay}
                drawingPaths={drawingPaths}
                overlayImage={overlayImage}
                overlayProps={overlayProps}
                isDrawing={isDrawing}
                isOverlayActive={isOverlayActive}
                isLoading={isLoading}
                handleMouseDown={handleMouseDown}
                handleMouseMove={handleMouseMove}
                handleMouseUp={handleMouseUp}
                canvasRef={canvasRef}
                previewCanvasRef={previewCanvasRef}
                tempFilters={tempFilters}
              />
            )}
          </div>
        </div>

        <aside className="right-sidebar">
          <div className="panel-content">
            <h3 className="panel-title">Adjustments</h3>
            <div className="panel-section">
              <h4>Filters</h4>
              {Object.keys(tempFilters).map((filter) => (
                <div key={filter} className="filter-control">
                  <label className="control-label">{filter}: {tempFilters[filter]}{filter === "blur" ? "px" : filter === "hueRotate" ? "deg" : "%"}</label>
                  <input
                    type="range"
                    min={filter === "blur" ? 0 : filter === "hueRotate" ? 0 : 0}
                    max={filter === "blur" ? 10 : filter === "hueRotate" ? 360 : 200}
                    value={tempFilters[filter]}
                    onChange={(e) => setTempFilters({ ...tempFilters, [filter]: parseInt(e.target.value) })}
                  />
                </div>
              ))}
              <button className="tool-button" onClick={() => handleApplyFilters()}>
                Apply Filters
              </button>
            </div>
            <div className="panel-section">
              <h4>Presets</h4>
              <select onChange={(e) => applyPreset(e.target.value)}>
                <option value="">Select Preset</option>
                <option value="grayscale">Grayscale</option>
                <option value="sepia">Sepia</option>
                <option value="vivid">Vivid</option>
                <option value="vintage">Vintage</option>
                <option value="cool">Cool</option>
                <option value="warm">Warm</option>
              </select>
            </div>
          </div>
        </aside>
      </main>

      <footer className="editor-footer">
        <button className="tool-button" onClick={handleSave}>Save</button>
        <button className="tool-button" onClick={handleDownload} disabled={isLoading || !editedImage}>
          Download Image
        </button>
      </footer>
    </div>
  );
}

export default Editor;