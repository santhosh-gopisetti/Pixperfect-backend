import { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate, Link, useLocation } from 'react-router-dom';

function Images() {
  const [images, setImages] = useState([]);
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const fetchImages = async () => {
      const token = localStorage.getItem('token');
      if (!token) {
        setMessage('Please login first');
        navigate('/login', { replace: true });
        return;
      }

      setIsLoading(true);
      setMessage('');

      try {
        const response = await axios.get('http://localhost:5001/images', {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        console.log('Fetched images:', response.data);
        setImages(response.data);
      } catch (error) {
        setMessage(error.response?.data?.error || 'Failed to fetch images');
      } finally {
        setIsLoading(false);
      }
    };
    fetchImages();
  }, [navigate, location.state?.refresh]);

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this image?')) {
      return;
    }

    const token = localStorage.getItem('token');
    try {
      await axios.delete(`http://localhost:5001/image/${id}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      setImages(images.filter((image) => image.id !== id));
      setMessage('Image deleted successfully');
    } catch (error) {
      setMessage(error.response?.data?.error || 'Failed to delete image');
    }
  };

  const handleEdit = (image) => {
    navigate('/editor', { state: { image } });
  };

  return (
    <div className="images-layout">
      

      <main className="images-main">
        <div className="images-container">
          <h2 id="images-heading">Your Images</h2>
          {isLoading && (
            <div className="loading-message">
              <span className="animate-spin inline-block h-6 w-6 border-b-2 border-white rounded-full mr-2"></span>
              Loading images...
            </div>
          )}
          {message && (
            <p className={message.includes('successfully') ? 'success-message' : 'error-message'}>
              {message}
            </p>
          )}
          {images.length === 0 && !isLoading ? (
            <p>No images found. Upload an image in the editor!</p>
          ) : (
            <div className="image-grid" aria-live="polite">
              {images.map((image) => (
                <div key={image.id} className="image-card">
                  <img
                    src={`http://localhost:5001${image.imagePath.startsWith('/') ? '' : '/'}${image.imagePath}`}
                    alt={`Uploaded image ${image.id}`}
                    crossOrigin="anonymous"
                  />
                  <div className="image-actions">
                    <button
                      onClick={() => handleEdit(image)}
                      aria-label={`Edit image ${image.id}`}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(image.id)}
                      className="delete-button"
                      aria-label={`Delete image ${image.id}`}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <footer className="images-footer">
        <p>
          Want to upload a new image? <Link to="/upload" className="link">Upload here</Link>
        </p>
      </footer>
    </div>
  );
}

export default Images;