import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';

function Upload() {
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();

    const token = localStorage.getItem('token');
    if (!token) {
      setMessage('Please login first');
      setTimeout(() => {
        navigate('/login', { replace: true });
      }, 1000);
      return;
    }

    // Validate file type
    if (!file) {
      setMessage('Please select a file');
      return;
    }
    if (!file.type.startsWith('image/')) {
      setMessage('Please select an image file');
      return;
    }

    setIsLoading(true);
    setMessage('');

    const formData = new FormData();
    formData.append('image', file);
    // Removed overlayProps and textOverlay from formData since they are no longer used

    try {
      const response = await axios.post('http://localhost:5001/upload', formData, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
      });
      setMessage(response.data.message);
      // Reset form
      setFile(null);
      // Redirect to /images after 1 second
      setTimeout(() => {
        navigate('/images', { replace: true });
      }, 1000);
    } catch (error) {
      setMessage(error.response?.data?.error || 'Upload failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="upload-layout">
      <header className="upload-header">
        <h1>Image Editor</h1>
      </header>

      <main className="upload-main">
        <div className="upload-container">
          <h2 id="upload-heading">Upload Image</h2>
          <form onSubmit={handleSubmit} aria-labelledby="upload-heading">
            <div className="form-group">
              <label htmlFor="image-upload">Choose an image</label>
              <input
                id="image-upload"
                type="file"
                accept="image/*"
                onChange={(e) => setFile(e.target.files[0])}
                required
                disabled={isLoading}
                aria-required="true"
              />
            </div>

            <button type="submit" disabled={isLoading}>
              {isLoading ? (
                <>
                  Uploading... <span className="animate-spin inline-block ml-2 h-4 w-4 border-b-2 border-white rounded-full"></span>
                </>
              ) : (
                'Upload'
              )}
            </button>
          </form>
          {message && (
            <p className={message.includes('failed') || message.includes('Please') ? 'error-message' : 'success-message'}>
              {message}
            </p>
          )}
        </div>
      </main>

      <footer className="upload-footer">
        <p>
          View your images <Link to="/images" className="link">here</Link>
        </p>
      </footer>
    </div>
  );
}

export default Upload;