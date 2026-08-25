import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  capacityOf,
  generateAccountFromPrivateKey,
  createSporeDOB,
  shannonToCKB,
  estimateDOBCost,
  fetchWalletDOBs,
  DOBItem,
} from "./lib";
import { generateRandomPrivateKey } from "./helper";
import { readEnvNetwork, Network } from "./ccc-client";
import { Script } from "@ckb-ccc/core";

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}

export function App() {
  // Network resolution (devnet / testnet / mainnet)
  const [network, setNetwork] = useState<Network>("testnet");

  // Wallet State
  const [privKey, setPrivKey] = useState(
    "0x6109170b275a09ad54877b82f7d9930f88cab5717d484fb4741ae9d1dd078cd6"
  );
  const [showPrivKey, setShowPrivKey] = useState(false);
  const [fromAddr, setFromAddr] = useState("");
  const [fromLock, setFromLock] = useState<Script>();
  const [balanceShannons, setBalanceShannons] = useState<bigint>(0n);
  const [copiedAddr, setCopiedAddr] = useState(false);

  // Navigation State
  const [activeTab, setActiveTab] = useState<"gallery" | "mint">("gallery");

  // Gallery State
  const [dobs, setDobs] = useState<DOBItem[]>([]);
  const [loadingGallery, setLoadingGallery] = useState(false);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const [selectedDOB, setSelectedDOB] = useState<DOBItem | null>(null);

  // Minting State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<Uint8Array | null>(null);
  const [estimatedCost, setEstimatedCost] = useState<{
    recommendedCKB: string;
    recommendedShannons: bigint;
    fileSizeBytes: number;
  } | null>(null);

  const [mintingPending, setMintingPending] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const [mintSuccess, setMintSuccess] = useState<{ txHash: string; outputIndex: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 1. Initial Network Verification
  useEffect(() => {
    try {
      const currentNet = readEnvNetwork();
      setNetwork(currentNet);
    } catch (err: any) {
      setGalleryError(err.message || "Invalid network configuration detected.");
    }
  }, []);

  // 2. Account & Balance Synchronization
  const updateAccountAndBalance = async () => {
    if (!privKey) return;
    try {
      // Validate key format (must be 64-char hex, optionally 0x prefixed)
      const cleanKey = privKey.startsWith("0x") ? privKey.slice(2) : privKey;
      if (cleanKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(cleanKey)) {
        setGalleryError("Invalid private key format. Must be a 32-byte hexadecimal string.");
        return;
      }
      setGalleryError(null);

      const account = await generateAccountFromPrivateKey(privKey);
      setFromAddr(account.address);
      setFromLock(account.lockScript);

      const cap = await capacityOf(account.address);
      setBalanceShannons(cap);
    } catch (err: any) {
      console.error("Failed to load account:", err);
      setGalleryError(err.message || "Failed to load wallet account details.");
    }
  };

  useEffect(() => {
    updateAccountAndBalance();
  }, [privKey]);

  // 3. Auto-refresh balance and DOB gallery every 10 seconds
  useEffect(() => {
    if (!fromAddr) return;

    loadGallery(fromAddr);

    const interval = setInterval(() => {
      capacityOf(fromAddr).then(setBalanceShannons).catch(console.error);
      loadGallery(fromAddr, true); // silent refresh
    }, 10000);

    return () => clearInterval(interval);
  }, [fromAddr]);

  // Load DOB Gallery
  const loadGallery = async (address: string, silent = false) => {
    if (!silent) setLoadingGallery(true);
    try {
      const items = await fetchWalletDOBs(address);
      setDobs(items);
      setGalleryError(null);
    } catch (err: any) {
      if (!silent) setGalleryError("Failed to fetch DOBs from blockchain: " + (err.message || err));
    } finally {
      if (!silent) setLoadingGallery(false);
    }
  };

  // Generate New Wallet
  const handleGenerateWallet = () => {
    const newKey = generateRandomPrivateKey();
    setPrivKey(newKey);
    setMintSuccess(null);
  };

  // Copy Address helper
  const handleCopyAddress = () => {
    navigator.clipboard.writeText(fromAddr);
    setCopiedAddr(true);
    setTimeout(() => setCopiedAddr(false), 2000);
  };

  // File Picker & Cost Calculation
  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    setMintError(null);
    setMintSuccess(null);

    // Create image preview URL
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    // Calculate real-time estimated CKB storage cost
    const cost = estimateDOBCost(file.size);
    setEstimatedCost(cost);

    // Read binary data
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        setFileContent(new Uint8Array(e.target.result as ArrayBuffer));
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  // Execute Spore DOB Creation
  const handleMintDOB = async () => {
    if (!selectedFile || !fileContent || !estimatedCost) return;

    // Check capacity before attempting transaction
    if (balanceShannons < estimatedCost.recommendedShannons) {
      setMintError(
        `Insufficient Capacity! Minting requires ~${estimatedCost.recommendedCKB} CKB in storage capacity, but wallet balance is ${shannonToCKB(balanceShannons)} CKB.`
      );
      return;
    }

    setMintingPending(true);
    setMintError(null);
    setMintSuccess(null);

    try {
      // Derive dynamic content-type from uploaded file, with fallback
      const contentType = selectedFile.type || "application/octet-stream";
      
      const { txHash, outputIndex } = await createSporeDOB(privKey, fileContent, contentType);
      
      setMintSuccess({ txHash, outputIndex });
      
      // Refresh wallet balance and gallery
      updateAccountAndBalance();
      loadGallery(fromAddr);
    } catch (err: any) {
      console.error("Minting Error:", err);
      setMintError(err.message || "Failed to broadcast Spore transaction to CKB network.");
    } finally {
      setMintingPending(false);
    }
  };

  // Block explorer URL helper
  const getExplorerUrl = (txHash: string) => {
    return network === "mainnet"
      ? `https://explorer.nervos.org/transaction/${txHash}`
      : `https://explorer.nervos.org/aggron/transaction/${txHash}`;
  };

  return (
    <div className="app-container">
      {/* Top Navigation Header */}
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon">📦</div>
          <div>
            <h1 className="brand-title">CKB DOB Gallery</h1>
            <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              On-Chain Digital Objects powered by Spore Protocol
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span className={`network-badge ${network}`}>
            <span className="dot"></span>
            {network}
          </span>

          <nav className="nav-tabs">
            <button
              className={`nav-btn ${activeTab === "gallery" ? "active" : ""}`}
              onClick={() => setActiveTab("gallery")}
            >
              Gallery ({dobs.length})
            </button>
            <button
              className={`nav-btn ${activeTab === "mint" ? "active" : ""}`}
              onClick={() => setActiveTab("mint")}
            >
              + Mint DOB
            </button>
          </nav>
        </div>
      </header>

      {/* Network Warning Banner */}
      <div className="banner-warning">
        <span style={{ fontSize: "18px" }}>⚠️</span>
        <div>
          <strong>Testnet/Devnet Environment:</strong> Funds in this wallet are testnet CKB. Storage capacity costs are real on-chain requirements (1 CKB per byte stored).
        </div>
      </div>

      {/* Wallet Management Control Panel */}
      <section className="wallet-card">
        <div className="wallet-grid">
          <div className="form-group">
            <label className="form-label">Signer Private Key</label>
            <div className="input-wrapper">
              <input
                type={showPrivKey ? "text" : "password"}
                className="input-field"
                value={privKey}
                onChange={(e) => setPrivKey(e.target.value)}
                placeholder="0x..."
              />
              <button
                type="button"
                className="btn-icon"
                onClick={() => setShowPrivKey(!showPrivKey)}
                title={showPrivKey ? "Hide Private Key" : "Show Private Key"}
              >
                {showPrivKey ? "👁️" : "🔒"}
              </button>
            </div>
          </div>

          <button className="btn-secondary" onClick={handleGenerateWallet}>
            ⚡ Generate New Wallet
          </button>
        </div>

        <div className="wallet-info">
          <div className="info-item" style={{ flex: 1 }}>
            <span className="info-label">Connected CKB Lock Address</span>
            <span className="info-value">
              <span style={{ fontFamily: "monospace", fontSize: "14px", overflow: "hidden", textOverflow: "ellipsis" }}>
                {fromAddr || "Calculating..."}
              </span>
              {fromAddr && (
                <button
                  className="btn-secondary"
                  onClick={handleCopyAddress}
                  style={{ padding: "4px 8px", fontSize: "12px" }}
                >
                  {copiedAddr ? "✓ Copied" : "Copy"}
                </button>
              )}
            </span>
          </div>

          <div className="info-item">
            <span className="info-label">Available Balance (Auto-Refreshes 10s)</span>
            <span className="info-value balance-amount">
              {shannonToCKB(balanceShannons)} CKB
            </span>
          </div>
        </div>
      </section>

      {/* Main View Area */}
      {activeTab === "mint" ? (
        <section className="mint-container">
          <h2 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "8px" }}>
            Mint On-Chain Digital Object (DOB)
          </h2>
          <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "24px" }}>
            Upload an image to create an immutable Spore Cell directly inside CKB storage.
          </p>

          {/* Upload Dropzone */}
          <div
            className={`dropzone ${previewUrl ? "active" : ""}`}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
            />

            {previewUrl ? (
              <div className="preview-box">
                <img src={previewUrl} alt="Upload Preview" />
              </div>
            ) : (
              <div>
                <div className="dropzone-icon">📁</div>
                <p style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                  Click or drag image here to upload
                </p>
                <p style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>
                  Supports PNG, JPEG, WebP, GIF
                </p>
              </div>
            )}
          </div>

          {/* File & Storage Cost Pre-Mint Estimator */}
          {selectedFile && estimatedCost && (
            <div className="cost-card">
              <div className="cost-row">
                <span style={{ color: "var(--text-muted)" }}>File Name</span>
                <span style={{ fontWeight: 600 }}>{selectedFile.name}</span>
              </div>
              <div className="cost-row">
                <span style={{ color: "var(--text-muted)" }}>Detected MIME Content-Type</span>
                <span style={{ fontFamily: "monospace", color: "var(--primary-cyan)" }}>
                  {selectedFile.type || "application/octet-stream"}
                </span>
              </div>
              <div className="cost-row">
                <span style={{ color: "var(--text-muted)" }}>File Size</span>
                <span>{(selectedFile.size / 1024).toFixed(2)} KB ({selectedFile.size} Bytes)</span>
              </div>
              <div className="cost-row">
                <span>Estimated CKB On-Chain Capacity Required</span>
                <span style={{ color: "var(--primary-emerald)", fontSize: "16px" }}>
                  ~{estimatedCost.recommendedCKB} CKB
                </span>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {mintError && <div className="error-banner">{mintError}</div>}

          {/* Pending / Success Messages */}
          {mintSuccess && (
            <div
              style={{
                background: "rgba(16, 185, 129, 0.1)",
                border: "1px solid rgba(16, 185, 129, 0.3)",
                color: "var(--primary-emerald)",
                padding: "16px",
                borderRadius: "var(--radius-md)",
                marginBottom: "20px",
              }}
            >
              <h4 style={{ fontWeight: 700, marginBottom: "6px" }}>🎉 DOB Created Successfully!</h4>
              <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "8px" }}>
                Spore Cell minted on-chain at index #{mintSuccess.outputIndex}.
              </p>
              <a
                href={getExplorerUrl(mintSuccess.txHash)}
                target="_blank"
                rel="noreferrer"
                className="tx-link"
                style={{ color: "var(--primary-cyan)", fontWeight: 600 }}
              >
                View Transaction on CKB Explorer ↗
              </a>
            </div>
          )}

          {/* Action Button */}
          <button
            className="btn-primary"
            onClick={handleMintDOB}
            disabled={!selectedFile || mintingPending}
          >
            {mintingPending ? (
              <>
                <span className="dot" style={{ animation: "pulse 1s infinite" }}></span>
                Broadcasting Spore Transaction to CKB...
              </>
            ) : (
              "🚀 Mint Spore Digital Object"
            )}
          </button>
        </section>
      ) : (
        <section>
          <div className="section-header">
            <h2 className="section-title">My DOB Collection</h2>
            <button className="btn-secondary" onClick={() => loadGallery(fromAddr)}>
              🔄 Refresh
            </button>
          </div>

          {galleryError && <div className="error-banner">{galleryError}</div>}

          {loadingGallery ? (
            <div className="gallery-grid">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="dob-card">
                  <div className="card-image-box skeleton"></div>
                  <div className="card-content">
                    <div className="skeleton" style={{ height: "20px", width: "60%" }}></div>
                    <div className="skeleton" style={{ height: "16px", width: "80%" }}></div>
                  </div>
                </div>
              ))}
            </div>
          ) : dobs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🖼️</div>
              <h3 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>
                No Digital Objects Found
              </h3>
              <p style={{ fontSize: "14px", color: "var(--text-muted)", marginBottom: "20px" }}>
                This wallet doesn't own any Spore Cell DOBs on this network yet.
              </p>
              <button className="btn-primary" onClick={() => setActiveTab("mint")}>
                + Mint Your First DOB
              </button>
            </div>
          ) : (
            <div className="gallery-grid">
              {dobs.map((dob, idx) => (
                <div key={idx} className="dob-card" onClick={() => setSelectedDOB(dob)}>
                  <div className="card-image-box">
                    <img src={dob.dataUrl} alt="DOB Content" />
                  </div>
                  <div className="card-content">
                    <span className="badge-tag">{dob.contentType}</span>
                    <a
                      href={getExplorerUrl(dob.txHash)}
                      target="_blank"
                      rel="noreferrer"
                      className="tx-link"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {dob.txHash.slice(0, 10)}...{dob.txHash.slice(-8)} ↗
                    </a>
                    <div className="card-footer">
                      <span>Capacity:</span>
                      <strong style={{ color: "var(--primary-emerald)" }}>{dob.capacityCKB} CKB</strong>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* DOB Detail Modal */}
      {selectedDOB && (
        <div className="modal-overlay" onClick={() => setSelectedDOB(null)}>
          <div className="modal-body" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelectedDOB(null)}>
              ✕
            </button>
            <h3 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "16px" }}>
              Spore Cell Details
            </h3>

            <img className="modal-image" src={selectedDOB.dataUrl} alt="Full Size DOB" />

            <table className="detail-table">
              <tbody>
                <tr>
                  <td>Spore Asset ID</td>
                  <td style={{ color: "var(--primary-cyan)" }}>{selectedDOB.sporeId}</td>
                </tr>
                <tr>
                  <td>Content MIME Type</td>
                  <td>{selectedDOB.contentType}</td>
                </tr>
                <tr>
                  <td>On-Chain Capacity</td>
                  <td style={{ color: "var(--primary-emerald)", fontWeight: 700 }}>
                    {selectedDOB.capacityCKB} CKB ({selectedDOB.capacityShannons.toString()} Shannons)
                  </td>
                </tr>
                <tr>
                  <td>Transaction Hash</td>
                  <td>
                    <a
                      href={getExplorerUrl(selectedDOB.txHash)}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "var(--primary-cyan)", textDecoration: "underline" }}
                    >
                      {selectedDOB.txHash} ↗
                    </a>
                  </td>
                </tr>
                <tr>
                  <td>Output Cell Index</td>
                  <td>#{selectedDOB.outputIndex}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
