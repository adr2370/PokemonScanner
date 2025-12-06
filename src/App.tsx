import { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import type { AppSettings, ScanResult, TabType } from './types';
import { loadSettings, saveSettings, loadMissingList, saveMissingList } from './utils/storage';
import { fetchSheetData } from './utils/sheets';
import { findMissingPokemonInImage } from './utils/vision';

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('scan');
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [missingList, setMissingList] = useState<string[]>(loadMissingList);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'loading'; text: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Save settings when they change
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // Save missing list when it changes
  useEffect(() => {
    saveMissingList(missingList);
  }, [missingList]);

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

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setCapturedImage(result);
      setScanResults([]);
    };
    reader.readAsDataURL(file);

    // Reset input so same file can be selected again
    event.target.value = '';
  }, []);

  const handleScan = async () => {
    if (!capturedImage) {
      setStatusMessage({ type: 'error', text: 'Please capture or select an image first' });
      return;
    }

    if (!settings.visionApiKey) {
      setStatusMessage({ type: 'error', text: 'Please enter your Gemini API key in Settings' });
      setActiveTab('settings');
      return;
    }

    if (missingList.length === 0) {
      setStatusMessage({ type: 'error', text: 'Please load your missing list from Google Sheets first' });
      setActiveTab('settings');
      return;
    }

    setIsLoading(true);
    setLoadingMessage('Analyzing image with Gemini AI...');
    setStatusMessage(null);

    try {
      // Send image and missing list to Gemini 3 Pro
      const foundPokemon = await findMissingPokemonInImage(
        capturedImage,
        missingList,
        settings.visionApiKey
      );

      // Create results - only show Pokemon from our missing list that were found
      const results: ScanResult[] = foundPokemon.map(name => ({
        name,
        status: 'need' as const,
        confidence: 1.0,
      }));

      setScanResults(results);

      if (results.length === 0) {
        setStatusMessage({
          type: 'success',
          text: 'No missing Pokemon found in this image'
        });
      } else {
        setStatusMessage({
          type: 'success',
          text: `Found ${results.length} Pokemon from your missing list!`
        });
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
            {/* Capture Zone */}
            <div
              className={`capture-zone ${capturedImage ? 'has-image' : ''}`}
              onClick={() => fileInputRef.current?.click()}
            >
              {capturedImage ? (
                <img src={capturedImage} alt="Captured" className="preview-image" />
              ) : (
                <>
                  <div className="capture-icon">📷</div>
                  <p className="capture-text">Tap to select a photo of your cards</p>
                </>
              )}
            </div>

            {/* Hidden File Inputs */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden-input"
              onChange={handleFileSelect}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden-input"
              onChange={handleFileSelect}
            />

            {/* Capture Actions */}
            <div className="capture-actions">
              <button
                className="btn-capture"
                onClick={() => cameraInputRef.current?.click()}
              >
                📷 Camera
              </button>
              <button
                className="btn-capture"
                onClick={() => fileInputRef.current?.click()}
              >
                🖼️ Gallery
              </button>
            </div>

            {/* Scan Button */}
            <button
              className="btn-scan"
              onClick={handleScan}
              disabled={!capturedImage || isLoading}
            >
              {isLoading ? 'Scanning...' : 'Scan for Missing Cards'}
            </button>

            {/* Results */}
            {scanResults.length > 0 && (
              <div className="results-panel">
                <div className="results-summary">
                  <div className="summary-card missing">
                    <div className="count">{scanResults.length}</div>
                    <div className="label">Found Missing</div>
                  </div>
                </div>

                <div className="results-list">
                  <h3>Missing Pokemon in Photo</h3>
                  {scanResults.map((result, index) => (
                    <div key={index} className="result-item">
                      <span className="result-name">{result.name}</span>
                      <span className="result-status need">NEED</span>
                    </div>
                  ))}
                </div>
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

            <div className="setting-group">
              <label>Google Gemini API Key</label>
              <input
                type="password"
                placeholder="Enter your API key"
                value={settings.visionApiKey}
                onChange={(e) => handleSettingChange('visionApiKey', e.target.value)}
              />
              <p className="setting-hint">
                Get an API key from Google AI Studio (aistudio.google.com)
              </p>
            </div>

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
