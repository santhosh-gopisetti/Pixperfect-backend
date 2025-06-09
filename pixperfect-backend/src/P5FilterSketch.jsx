// src/P5FilterSketch.jsx
import React, { useRef, useEffect } from "react";
import p5 from "p5";
import "./p5.fip.js"; // Import your custom filter code (fip.*)
 
function P5FilterSketch({ imageUrl, currentFilter, onExportImage }) {
  const sketchRef = useRef();

  useEffect(() => {
    let myp5;
    let customShaders = [];
    let img;
    let shaderIndex = 0;

    // The p5 sketch
    const sketch = (s) => {
      s.preload = () => {
        // Load the image from the parent prop
        img = s.loadImage(imageUrl);
      };

      s.setup = () => {
        s.createCanvas(600, 400, s.WEBGL);

        // Create an array of shaders based on your p5.fip.js
        // For example, if you have brightness, motionBlur, etc.:
        customShaders.push(
          s.createShader(window.fip.defaultVert, window.fip.brightness)
        );
        customShaders.push(
          s.createShader(window.fip.defaultVert, window.fip.motionBlur)
        );
        customShaders.push(
          s.createShader(window.fip.defaultVert, window.fip.glitch)
        );
        // ... Add more as needed

        // Decide which shader index corresponds to which filter
        // e.g., if currentFilter === "brightness", use customShaders[0]
        if (currentFilter === "brightness") {
          shaderIndex = 0;
        } else if (currentFilter === "motionBlur") {
          shaderIndex = 1;
        } else if (currentFilter === "glitch") {
          shaderIndex = 2;
        } 
        // etc.
      };

      s.draw = () => {
        s.background(0);

        // Apply the chosen shader
        s.shader(customShaders[shaderIndex]);

        // Pass the image to the shader
        customShaders[shaderIndex].setUniform("tex0", img);

        // Draw a rectangle that covers the canvas
        s.rect(0, 0, s.width, s.height);
      };
    };

    // Create a new p5 instance
    myp5 = new p5(sketch, sketchRef.current);

    return () => {
      // Cleanup on unmount
      myp5.remove();
    };
  }, [imageUrl, currentFilter]);

  // Export the final image from the p5 canvas
  const handleExport = () => {
    // We can call this from the parent or add a button here
    const canvas = sketchRef.current.querySelector("canvas");
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    onExportImage(dataUrl);
  };

  return (
    <div>
      <div ref={sketchRef} />
      {/* Optionally, a button here to export image from p5 */}
      {/* <button onClick={handleExport}>Export P5 Image</button> */}
    </div>
  );
}

export default P5FilterSketch;
