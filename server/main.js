const WebSocket = require('ws');
const http = require('http');
const url = require('url');

// Global state
let currentFrame = "";
let uploadConnections = 0;
let downloadClients = new Set();

const fs = require('fs');

// Read HTML file once at startup
const indexHTML = fs.readFileSync('index.html', 'utf8');

// Replace the existing server creation with:
const server = http.createServer((req, res) => {
    if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(indexHTML);
    }
});

// Create WebSocket server
const wss = new WebSocket.Server({
    server,
    verifyClient: (info) => {
        const pathname = url.parse(info.req.url).pathname;
        return pathname === '/upload' || pathname === '/download';
    }
});

// Handle WebSocket connections
wss.on('connection', (ws, req) => {
    const pathname = url.parse(req.url).pathname;

    if (pathname === '/upload') {
        handleUploadConnection(ws);
    } else if (pathname === '/download') {
        handleDownloadConnection(ws);
    }
});

function handleUploadConnection(ws) {
    uploadConnections++;
    console.log(`Upload client connected. Total uploaders: ${uploadConnections}`);

    // Notify download clients that stream is now active
    if (uploadConnections === 1) {
        notifyDownloadClients({ status: "active_stream" });
    }

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);

            if (message.type === 'frame' && message.data) {
                // Update global frame
                currentFrame = message.data;
                console.log(`Frame updated (${message.data.length} chars)`);
            }
        } catch (error) {
            console.error('Error parsing upload message:', error);
        }
    });

    ws.on('close', () => {
        uploadConnections--;
        console.log(`Upload client disconnected. Total uploaders: ${uploadConnections}`);

        // Notify download clients if no more uploaders
        if (uploadConnections === 0) {
            notifyDownloadClients({ status: "no_stream" });
            currentFrame = ""; // Clear frame when no uploaders
        }
    });

    ws.on('error', (error) => {
        console.error('Upload WebSocket error:', error);
    });
}

function handleDownloadConnection(ws) {
    downloadClients.add(ws);
    console.log(`Download client connected. Total downloaders: ${downloadClients.size}`);

    // Immediately notify new client of current stream status
    if (uploadConnections > 0) {
        ws.send(JSON.stringify({ status: "active_stream" }));
    } else {
        ws.send(JSON.stringify({ status: "no_stream" }));
    }

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);

            if (message.action === 'get_frame') {
                // Send current frame to requesting client
                if (currentFrame) {
                    ws.send(JSON.stringify({
                        type: "frame",
                        data: currentFrame,
                        timestamp: Date.now()
                    }));
                }
            }
        } catch (error) {
            console.error('Error parsing download message:', error);
        }
    });

    ws.on('close', () => {
        downloadClients.delete(ws);
        console.log(`Download client disconnected. Total downloaders: ${downloadClients.size}`);
    });

    ws.on('error', (error) => {
        console.error('Download WebSocket error:', error);
    });
}

function notifyDownloadClients(message) {
    const messageStr = JSON.stringify(message);
    downloadClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(messageStr);
        }
    });
    console.log(`Notified ${downloadClients.size} download clients:`, message);
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`WebSocket server running on port ${PORT}`);
    console.log(`Upload endpoint: ws://localhost:${PORT}/upload`);
    console.log(`Download endpoint: ws://localhost:${PORT}/download`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    wss.close(() => {
        server.close(() => {
            console.log('Server closed');
            process.exit(0);
        });
    });
});