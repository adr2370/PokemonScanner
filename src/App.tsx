import { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import type { AppSettings, ScanResult, TabType } from './types';
import { loadSettings, saveSettings, loadMissingList, saveMissingList } from './utils/storage';
import { fetchSheetData } from './utils/sheets';
import { findMissingPokemonWithOCR } from './utils/ocr';

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('scan');
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [missingList, setMissingList] = useState<string[]>(loadMissingList);
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'loading'; text: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Camera state
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Save settings when they change
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // Save missing list when it changes
  useEffect(() => {
    saveMissingList(missingList);
  }, [missingList]);

  // Cleanup camera on unmount or tab change
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Stop camera when leaving scan tab
  useEffect(() => {
    if (activeTab !== 'scan') {
      stopCamera();
    }
  }, [activeTab]);

  const handleSettingChange = (key: keyof AppSettings, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleLoadSheet = async () => {
    if (!settings.sheetUrl) {
      setStatusMessage({ type: 'error', text: 'Please enter a Google Sheet URL' });
      return;
    }

    setIsLoading(true);
    setLoadingMessage('Loading missing list from Google Sheets...');
    setStatusMessage(null);

    try {
      const cards = await fetchSheetData(settings.sheetUrl, settings.sheetTab || '', settings.sheetColumn || 'A');
      setMissingList(cards);
      setStatusMessage({ type: 'success', text: `Loaded ${cards.length} cards from sheet` });
    } catch (error) {
      setStatusMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to load sheet' });
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsCameraActive(true);

        // Start continuous scanning
        startContinuousScanning();
      }
    } catch (error) {
      console.error('Camera error:', error);
      setStatusMessage({
        type: 'error',
        text: 'Could not access camera. Please check permissions.'
      });
    }
  };

  const stopCamera = () => {
    scanningRef.current = false;
    setIsScanning(false);

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsCameraActive(false);
  };

  const captureFrame = useCallback((): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    if (!ctx || video.videoWidth === 0) return null;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    return canvas.toDataURL('image/jpeg', 0.8);
  }, []);

  const startContinuousScanning = useCallback(() => {
    if (missingList.length === 0) {
      setStatusMessage({
        type: 'error',
        text: 'Please load your missing list first in Settings'
      });
      return;
    }

    scanningRef.current = true;
    setIsScanning(true);

    const scanLoop = async () => {
      if (!scanningRef.current) return;

      const frame = captureFrame();
      if (!frame) {
        // Retry after a short delay if frame capture failed
        setTimeout(scanLoop, 500);
        return;
      }

      setScanStatus('Scanning...');

      try {
        const foundPokemon = await findMissingPokemonWithOCR(
          frame,
          missingList,
          (progress) => {
            setScanStatus(progress.status);
          }
        );

        if (foundPokemon.length > 0) {
          const results: ScanResult[] = foundPokemon.map(name => ({
            name,
            status: 'need' as const,
            confidence: 1.0,
          }));
          setScanResults(results);
        }

        setScanStatus('');
      } catch (error) {
        console.error('Scan error:', error);
      }

      // Continue scanning after a delay (1.5 seconds between scans)
      if (scanningRef.current) {
        setTimeout(scanLoop, 1500);
      }
    };

    scanLoop();
  }, [captureFrame, missingList]);

  // Restart scanning when missing list changes and camera is active
  useEffect(() => {
    if (isCameraActive && missingList.length > 0 && !scanningRef.current) {
      startContinuousScanning();
    }
  }, [isCameraActive, missingList, startContinuousScanning]);

  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Stop camera if running
    stopCamera();

    const reader = new FileReader();
    reader.onload = async (e) => {
      const imageData = e.target?.result as string;

      if (missingList.length === 0) {
        setStatusMessage({ type: 'error', text: 'Please load your missing list first' });
        return;
      }

      setIsLoading(true);
      setLoadingMessage('Scanning image...');

      try {
        const foundPokemon = await findMissingPokemonWithOCR(
          imageData,
          missingList,
          (progress) => {
            setLoadingMessage(progress.status);
          }
        );

        const results: ScanResult[] = foundPokemon.map(name => ({
          name,
          status: 'need' as const,
          confidence: 1.0,
        }));

        setScanResults(results);

        if (results.length === 0) {
          setStatusMessage({ type: 'success', text: 'No missing Pokemon found in this image' });
        } else {
          setStatusMessage({ type: 'success', text: `Found ${results.length} from your missing list!` });
        }
      } catch (error) {
        setStatusMessage({
          type: 'error',
          text: error instanceof Error ? error.message : 'Failed to scan image'
        });
      } finally {
        setIsLoading(false);
        setLoadingMessage('');
      }
    };
    reader.readAsDataURL(file);

    event.target.value = '';
  }, [missingList]);

  const clearResults = () => {
    setScanResults([]);
  };

  const filteredMissingList = missingList.filter(card =>
    card.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="app">
      {/* Loading Overlay */}
      {isLoading && (
        <div className="loading-overlay">
          <div className="spinner"></div>
          <p>{loadingMessage}</p>
        </div>
      )}

      {/* Header */}
      <header className="header">
        <h1>Pokemon Card Scanner</h1>
      </header>

      {/* Tab Navigation */}
      <nav className="tab-nav">
        <button
          className={`tab-btn ${activeTab === 'scan' ? 'active' : ''}`}
          onClick={() => setActiveTab('scan')}
        >
          Scan Cards
        </button>
        <button
          className={`tab-btn ${activeTab === 'list' ? 'active' : ''}`}
          onClick={() => setActiveTab('list')}
        >
          Missing List
        </button>
        <button
          className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          Settings
        </button>
      </nav>

      {/* Main Content */}
      <main className="main-content">
        {/* Status Message */}
        {statusMessage && (
          <div className={`status-message ${statusMessage.type}`}>
            {statusMessage.text}
          </div>
        )}

        {/* Scan Tab */}
        {activeTab === 'scan' && (
          <div className="scanner-panel">
            {/* Camera View */}
            <div className="camera-container">
              <video
                ref={videoRef}
                className={`camera-video ${isCameraActive ? 'active' : ''}`}
                playsInline
                muted
              />
              <canvas ref={canvasRef} className="hidden-canvas" />

              {!isCameraActive && (
                <div className="camera-placeholder">
                  <div className="capture-icon">📷</div>
                  <p>Tap "Start Camera" to begin scanning</p>
                </div>
              )}

              {/* Scanning indicator */}
              {isScanning && (
                <div className="scanning-indicator">
                  <div className="scan-line"></div>
                  {scanStatus && <span className="scan-status">{scanStatus}</span>}
                </div>
              )}

              {/* Live results overlay */}
              {isCameraActive && scanResults.length > 0 && (
                <div className="live-results">
                  <div className="live-results-header">
                    <span>Found: {scanResults.length}</span>
                    <button onClick={clearResults} className="btn-clear">Clear</button>
                  </div>
                  <div className="live-results-list">
                    {scanResults.map((result, index) => (
                      <div key={index} className="live-result-item">
                        {result.name}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Camera Controls */}
            <div className="camera-controls">
              {!isCameraActive ? (
                <button className="btn-camera-start" onClick={startCamera}>
                  📷 Start Camera
                </button>
              ) : (
                <button className="btn-camera-stop" onClick={stopCamera}>
                  ⏹️ Stop Camera
                </button>
              )}

              <button
                className="btn-gallery"
                onClick={() => fileInputRef.current?.click()}
              >
                🖼️ From Gallery
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden-input"
              onChange={handleFileSelect}
            />

            {/* Results (when camera is off) */}
            {!isCameraActive && scanResults.length > 0 && (
              <div className="results-panel">
                <div className="results-summary">
                  <div className="summary-card missing">
                    <div className="count">{scanResults.length}</div>
                    <div className="label">Found Missing</div>
                  </div>
                </div>

                <div className="results-list">
                  <h3>Missing Pokemon Found</h3>
                  {scanResults.map((result, index) => (
                    <div key={index} className="result-item">
                      <span className="result-name">{result.name}</span>
                      <span className="result-status need">NEED</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {missingList.length === 0 && (
              <div className="empty-state small">
                <p>Load your missing list in Settings to start scanning</p>
              </div>
            )}
          </div>
        )}

        {/* Missing List Tab */}
        {activeTab === 'list' && (
          <div className="missing-list-panel">
            <div className="list-stats">
              <div className="stat-badge">
                <div className="number">{missingList.length}</div>
                <div className="text">Cards Missing</div>
              </div>
            </div>

            {missingList.length > 0 ? (
              <>
                <div className="search-box">
                  <span>🔍</span>
                  <input
                    type="text"
                    placeholder="Search missing cards..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                <div className="missing-cards-list">
                  {filteredMissingList.map((card, index) => (
                    <div key={index} className="missing-card-item">
                      {card}
                    </div>
                  ))}
                  {filteredMissingList.length === 0 && searchQuery && (
                    <div className="empty-state">
                      <p>No cards matching "{searchQuery}"</p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <div className="icon">📋</div>
                <p>No missing list loaded.<br />Go to Settings to connect your Google Sheet.</p>
              </div>
            )}
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div className="settings-panel">
            <div className="setting-group">
              <label>Google Sheet URL</label>
              <input
                type="url"
                placeholder="https://docs.google.com/spreadsheets/d/..."
                value={settings.sheetUrl}
                onChange={(e) => handleSettingChange('sheetUrl', e.target.value)}
              />
              <p className="setting-hint">
                Your sheet must be publicly accessible (Share → Anyone with the link can view)
              </p>
            </div>

            <div className="setting-group">
              <label>Sheet Tab Name</label>
              <input
                type="text"
                placeholder="Sheet2"
                value={settings.sheetTab}
                onChange={(e) => handleSettingChange('sheetTab', e.target.value)}
              />
              <p className="setting-hint">
                Enter the name of the tab containing your missing list (leave empty for first tab)
              </p>
            </div>

            <div className="setting-group">
              <label>Column with Pokemon Names</label>
              <input
                type="text"
                placeholder="A"
                value={settings.sheetColumn}
                onChange={(e) => handleSettingChange('sheetColumn', e.target.value.toUpperCase())}
                maxLength={2}
              />
              <p className="setting-hint">
                Enter the column letter that contains your missing Pokemon names (e.g., A, B, C)
              </p>
            </div>

            <button
              className="btn-primary"
              onClick={handleLoadSheet}
              disabled={!settings.sheetUrl || isLoading}
            >
              {isLoading ? 'Loading...' : 'Load Missing List'}
            </button>

            {missingList.length > 0 && (
              <div className="status-message success">
                {missingList.length} cards loaded from sheet
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
