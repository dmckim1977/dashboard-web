// GEXRay 2.0 Plotly Implementation

// Main variables
let chart; // Reference to the main Plotly chart
let currentTicker = ''; // Current selected ticker
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
const retryDelay = 1000;
let lastMessageTimestamp = null;
let source = null; // SSE connection
const DEBUG = true;

// Data arrays
let candles = [],
    zero_gamma = [],
    major_pos = [],
    major_neg = [],
    volume = [],
    minor_pos = [],
    minor_neg = [];

// Wiseguy flag data arrays
let putsBearishFlags = [],
    putsBullishFlags = [],
    callsBearishFlags = [],
    callsBullishFlags = [];

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    // Set up event listeners
    window.addEventListener('resize', handleResize);

    // Initialize selectors
    initSelectors();

    // Initialize SSE connection
    initSSEConnection();

    // Initialize theme toggle
    initThemeToggle();
});

// Handle window resize events
function handleResize() {
    if (chart) {
        Plotly.relayout('container', {
            width: document.getElementById('container').clientWidth,
            height: document.getElementById('container').clientHeight
        });
    }
}

// Initialize ticker selectors and event handlers
function initSelectors() {
    const tickerSelect = document.getElementById('ticker-select');
    updateStatus('Loading tickers...');

    // Load tickers from API
    fetch('/api/v2/gexray/tickers')
        .then(response => response.json())
        .then(data => {
            if (data && data.tickers && Array.isArray(data.tickers)) {
                // Sort tickers alphabetically
                const sortedTickers = data.tickers.sort();

                // Clear any existing options
                tickerSelect.innerHTML = '';

                // Add default option
                const defaultOption = document.createElement('option');
                defaultOption.value = 'SPY';
                defaultOption.textContent = '-- Select Ticker --';
                tickerSelect.appendChild(defaultOption);

                // Add options
                sortedTickers.forEach(ticker => {
                    const option = document.createElement('option');
                    option.value = ticker;
                    option.textContent = ticker;
                    tickerSelect.appendChild(option);
                });

                updateStatus('Ready - Select a ticker');
            } else {
                console.error('Invalid ticker data format from API');
                updateStatus('Error loading tickers', true);

                // Add default option if API fails
                tickerSelect.innerHTML = '<option value="">No tickers available</option>';
            }
        })
        .catch(error => {
            console.error('Error fetching ticker list:', error);
            updateStatus('Error loading tickers', true);

            // Add default option if API fails
            tickerSelect.innerHTML = '<option value="">Error loading tickers</option>';
        });

    // Handle ticker change
    tickerSelect.addEventListener('change', function() {
        const newTicker = this.value;
        if (newTicker && newTicker !== currentTicker) {
            currentTicker = newTicker;

            // Update chart title
            document.getElementById('chart-title').textContent = `${currentTicker} GEXRay V2`;

            // Reset data arrays and fetch data
            resetDataArrays();
            fetchChartData();
            fetchWiseguyFlags();

            // Update status to show we're now listening for the new ticker
            updateStatus(`Connected - Streaming ${currentTicker} data`);
        }
    });

    // Initialize additional selectors
    initAdditionalSelectors();
}

// Initialize additional selectors (minor walls, etc.)
function initAdditionalSelectors() {
    const minorWallsSelect = document.getElementById('minor-walls');

    // Minor walls visibility handler
    if (minorWallsSelect) {
        minorWallsSelect.addEventListener('change', function() {
            const showMinorWalls = this.value === 'show';

            if (chart) {
                // Find the minor wall traces
                const update = {
                    visible: []
                };

                // We need to set visibility for all traces
                // Find the indices of the minor wall series
                const minorPosIndex = findTraceIndexByName('Call Wall Minor');
                const minorNegIndex = findTraceIndexByName('Put Wall Minor');

                if (minorPosIndex !== -1 && minorNegIndex !== -1) {
                    const data = chart.data;
                    for (let i = 0; i < data.length; i++) {
                        // Only update the visibility for minor walls
                        if (i === minorPosIndex || i === minorNegIndex) {
                            update.visible[i] = showMinorWalls;
                        } else {
                            // Keep current visibility for other traces
                            update.visible[i] = data[i].visible;
                        }
                    }

                    // Update the plot
                    Plotly.update('container', {}, update);
                }
            }
        });
    }
}

// Helper function to find trace index by name
function findTraceIndexByName(traceName) {
    if (!chart || !chart.data) return -1;

    for (let i = 0; i < chart.data.length; i++) {
        if (chart.data[i].name === traceName) {
            return i;
        }
    }
    return -1;
}

// Reset data arrays
function resetDataArrays() {
    candles = [];
    zero_gamma = [];
    major_pos = [];
    major_neg = [];
    volume = [];
    minor_pos = [];
    minor_neg = [];

    // Reset flag arrays
    putsBearishFlags = [];
    putsBullishFlags = [];
    callsBearishFlags = [];
    callsBullishFlags = [];
}

// Status update function
function updateStatus(status, isError = false) {
    // Update hidden status element
    const statusElement = document.getElementById('connection-status');
    statusElement.textContent = status;

    // Only update for connection status changes
    if (status.includes('Connected') ||
        status.includes('Disconnected') ||
        status.includes('Connecting') ||
        status.includes('Reconnecting')) {

        updateConnectionButton(status, isError);
    }
}

// Update connection button
function updateConnectionButton(status, isError = false) {
    const buttonText = document.getElementById('connection-text');
    const indicator = document.getElementById('connection-indicator');

    // Shorten status for button display
    let shortStatus = status;
    if (status.includes('Connected')) {
        shortStatus = 'Connected';
    } else if (status.includes('Connecting')) {
        shortStatus = 'Connecting';
    } else if (status.includes('Error')) {
        shortStatus = 'Error';
    } else if (status.includes('Reconnecting')) {
        shortStatus = 'Reconnecting';
    } else if (status.includes('Disconnected')) {
        shortStatus = 'Disconnected';
    }

    buttonText.textContent = shortStatus;

    // Update indicator color
    if (isError) {
        indicator.style.backgroundColor = '#dc3545'; // red
    } else if (status.toLowerCase().includes('connected')) {
        indicator.style.backgroundColor = '#28a745'; // green
    } else if (status.toLowerCase().includes('disconnected')) {
        indicator.style.backgroundColor = '#dc3545'; // red
    } else {
        indicator.style.backgroundColor = '#007bff'; // blue
    }
}

// Update connection timestamp
function updateConnectionTimestamp(timestamp) {
    const buttonText = document.getElementById('connection-text');
    const formattedTime = new Date(timestamp).toLocaleTimeString();
    buttonText.textContent = `Connected • ${formattedTime}`;
}

// Fetch wiseguy flags data
function fetchWiseguyFlags() {
    if (!currentTicker) return;

    // Fetch from API
    fetch(`/api/v1/wiseguy_alerts/wiseguy-flags/${currentTicker}`)
        .then(response => response.json())
        .then(data => {
            // Assign flag data
            putsBearishFlags = (data.puts_bearish || []).map(flag => ({
                x: flag.x,  // timestamp in milliseconds
                title: 'P', // title for flag
                text: flag.text || '' // full alert text for tooltip
            }));

            putsBullishFlags = (data.puts_bullish || []).map(flag => ({
                x: flag.x,
                title: 'P',
                text: flag.text || ''
            }));

            callsBearishFlags = (data.calls_bearish || []).map(flag => ({
                x: flag.x,
                title: 'C',
                text: flag.text || ''
            }));

            callsBullishFlags = (data.calls_bullish || []).map(flag => ({
                x: flag.x,
                title: 'C',
                text: flag.text || ''
            }));

            // If chart already exists, update the flag series
            if (chart) {
                updateFlagSeries();
            }
        })
        .catch(error => {
            console.error('Error fetching wiseguy flags:', error);
        });
}

// Update flag series in existing chart
function updateFlagSeries() {
    // For Plotly, we need to update the scatter traces that represent flags
    // Find indices for each flag series
    const putsBearishIndex = findTraceIndexByName('Puts Bearish');
    const putsBullishIndex = findTraceIndexByName('Puts Bullish');
    const callsBearishIndex = findTraceIndexByName('Calls Bearish');
    const callsBullishIndex = findTraceIndexByName('Calls Bullish');

    // Prepare update data
    const updateData = {};

    if (putsBearishIndex !== -1) {
        updateData[putsBearishIndex] = {
            x: putsBearishFlags.map(flag => new Date(flag.x)),
            text: putsBearishFlags.map(flag => flag.text),
            hovertext: putsBearishFlags.map(flag => flag.text)
        };
    }

    if (putsBullishIndex !== -1) {
        updateData[putsBullishIndex] = {
            x: putsBullishFlags.map(flag => new Date(flag.x)),
            text: putsBullishFlags.map(flag => flag.text),
            hovertext: putsBullishFlags.map(flag => flag.text)
        };
    }

    if (callsBearishIndex !== -1) {
        updateData[callsBearishIndex] = {
            x: callsBearishFlags.map(flag => new Date(flag.x)),
            text: callsBearishFlags.map(flag => flag.text),
            hovertext: callsBearishFlags.map(flag => flag.text)
        };
    }

    if (callsBullishIndex !== -1) {
        updateData[callsBullishIndex] = {
            x: callsBullishFlags.map(flag => new Date(flag.x)),
            text: callsBullishFlags.map(flag => flag.text),
            hovertext: callsBullishFlags.map(flag => flag.text)
        };
    }

    // Apply updates if we have any
    if (Object.keys(updateData).length > 0) {
        Plotly.update('container', updateData);
    }
}

// Fetch chart data
function fetchChartData() {
    updateStatus(`Loading data for ${currentTicker}...`);

    // Fetch data from API
    fetch(`/api/v2/gexray/chart-1min-candles/${currentTicker}`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return response.json();
        })
        .then(chartData => {
            // Access the nested data
            const candles = chartData.data?.candles || [];
            const major_pos = chartData.data?.major_pos || [];
            const minor_pos = chartData.data?.minor_pos || [];
            const major_neg = chartData.data?.major_neg || [];
            const minor_neg = chartData.data?.minor_neg || [];
            const zero_gamma = chartData.data?.zero_gamma || [];
            const volume = chartData.data?.volume || [];

            if (!chartData.data || !candles || candles.length === 0) {
                console.error('No valid candles data received.');
                updateStatus(`No data available for ${currentTicker}`, true);
                createChart(); // Create empty chart
                return;
            }

            // Create chart with the data
            createChart(candles, major_pos, minor_pos, major_neg, minor_neg, zero_gamma, volume);

            // If we have data, fetch wiseguy flags
            fetchWiseguyFlags();

            // Update status
            updateStatus(`Chart created for ${currentTicker}`);
        })
        .catch(error => {
            console.error('Error fetching candle data:', error);
            updateStatus(`Error loading chart data: ${error.message}`, true);

            // Create chart anyway with empty data
            createChart();
        });
}

// Initialize SSE connection
function initSSEConnection() {
    updateStatus('Connecting to live feed...');

    // Close existing connection if any
    if (source) {
        source.close();
    }

    source = new EventSource('https://sse.sweet-forest-e367.workers.dev/sse/gexray');

    source.onopen = () => {
        updateStatus('Connected - Live data streaming');
        reconnectAttempts = 0;
        console.log('SSE connection opened, ready to receive data');
    };

    source.onmessage = handleSSEMessage;

    source.onerror = handleSSEError;
}

// Handle SSE messages
function handleSSEMessage(event) {
    try {
        if (DEBUG) console.log("Received SSE message:", event.data);
        const eventData = JSON.parse(event.data);

        // Store current time as last message timestamp
        lastMessageTimestamp = new Date();

        // Update the connection button with the timestamp
        updateConnectionTimestamp(lastMessageTimestamp);

        // Check for the correct message type
        if ((eventData.msg_type === "gex3") && eventData.data) {
            const data = eventData.data;

            // Log data for debugging
            if (DEBUG && data && data.ticker) {
                console.log(`Message ticker: ${data.ticker}, Current ticker: ${currentTicker}`);
            }

            // Case-insensitive ticker matching
            if (data.ticker && data.ticker.toUpperCase() === currentTicker.toUpperCase()) {
                console.log(`Processing ${currentTicker} data point`);
                // Update data arrays with new values
                updateChartWithLiveData(data);
            } else if (DEBUG) {
                console.log(`Ignoring data for ticker ${data.ticker}, waiting for ${currentTicker}`);
            }
        }
    } catch (error) {
        console.error('Error processing SSE message:', error, event.data);
    }
}

// Update the chart with live data
function updateChartWithLiveData(data) {
    // Add implementation here for updating chart with live data points
    // This would involve adding new points to the data arrays and
    // then using Plotly.extendTraces() to add the points to the chart

    // Example (pseudocode):
    // if (chart && data.candle) {
    //     const newCandle = [data.candle.x, data.candle.open, data.candle.high, data.candle.low, data.candle.close];
    //     candles.push(newCandle);
    //     Plotly.extendTraces('container', { open: [[data.candle.open]], high: [[data.candle.high]], ... }, [0]);
    // }
}

// Handle SSE errors and reconnection
function handleSSEError(error) {
    console.error('SSE connection error:', error);
    updateStatus('Connection issue - attempting to reconnect', true);
    source.close();

    if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        const delay = retryDelay * Math.pow(2, reconnectAttempts - 1);
        setTimeout(initSSEConnection, delay);
        updateStatus(`Reconnecting... (Attempt ${reconnectAttempts}/${maxReconnectAttempts})`, true);
    } else {
        updateStatus('Connection failed. Data updates paused.', true);
    }
}

// Close SSE connection
function closeSseConnection() {
    if (source) {
        source.close();
        source = null;
        updateStatus('Disconnected', true);
    }
}

// Create the Plotly chart
function createChart(candlesData = [], majorPosData = [], minorPosData = [], majorNegData = [], minorNegData = [], zeroGammaData = [], volumeData = []) {
    // Target div
    const container = document.getElementById('container');

    try {
        // Process candles data for Plotly
        const dates = candlesData.map(candle => new Date(candle[0]));
        const opens = candlesData.map(candle => candle[1]);
        const highs = candlesData.map(candle => candle[2]);
        const lows = candlesData.map(candle => candle[3]);
        const closes = candlesData.map(candle => candle[4]);

        // Process other data series
        const zeroGammaDates = zeroGammaData.map(item => new Date(item[0]));
        const zeroGammaValues = zeroGammaData.map(item => item[1]);

        const majorPosGammaDates = majorPosData.map(item => new Date(item[0]));
        const majorPosGammaValues = majorPosData.map(item => item[1]);

        const majorNegGammaDates = majorNegData.map(item => new Date(item[0]));
        const majorNegGammaValues = majorNegData.map(item => item[1]);

        const minorPosGammaDates = minorPosData.map(item => new Date(item[0]));
        const minorPosGammaValues = minorPosData.map(item => item[1]);

        const minorNegGammaDates = minorNegData.map(item => new Date(item[0]));
        const minorNegGammaValues = minorNegData.map(item => item[1]);

        const volumeDates = volumeData.map(item => new Date(item[0]));
        const volumeValues = volumeData.map(item => item[1]);

        // Create data array for Plotly
        const data = [
            // Candlestick chart
            {
                type: 'candlestick',
                x: dates,
                open: opens,
                high: highs,
                low: lows,
                close: closes,
                name: 'OHLC',
                yaxis: 'y',
                increasing: {line: {color: '#28a745'}},
                decreasing: {line: {color: '#dc3545'}},
                hoverinfo: 'text',
                hovertext: dates.map((date, i) => {
                    return `Date: ${date.toLocaleString()}<br>` +
                           `Open: ${opens[i]}<br>` +
                           `High: ${highs[i]}<br>` +
                           `Low: ${lows[i]}<br>` +
                           `Close: ${closes[i]}`;
                })
            },
            // Zero Gamma
            {
                type: 'scatter',
                x: zeroGammaDates,
                y: zeroGammaValues,
                mode: 'markers',
                name: 'Zero Gamma',
                marker: {
                    color: 'yellow',
                    size: 4
                },
                yaxis: 'y'
            },
            // Major Call Wall
            {
                type: 'scatter',
                x: majorPosGammaDates,
                y: majorPosGammaValues,
                mode: 'markers',
                name: 'Call Wall Major',
                marker: {
                    color: 'green',
                    size: 4
                },
                yaxis: 'y'
            },
            // Major Put Wall
            {
                type: 'scatter',
                x: majorNegGammaDates,
                y: majorNegGammaValues,
                mode: 'markers',
                name: 'Put Wall Major',
                marker: {
                    color: 'red',
                    size: 4
                },
                yaxis: 'y'
            },
            // Minor Call Wall
            {
                type: 'scatter',
                x: minorPosGammaDates,
                y: minorPosGammaValues,
                mode: 'markers',
                name: 'Call Wall Minor',
                marker: {
                    color: 'green',
                    size: 3,
                    opacity: 0.3
                },
                yaxis: 'y',
                visible: document.getElementById('minor-walls').value === 'show'
            },
            // Minor Put Wall
            {
                type: 'scatter',
                x: minorNegGammaDates,
                y: minorNegGammaValues,
                mode: 'markers',
                name: 'Put Wall Minor',
                marker: {
                    color: 'red',
                    size: 3,
                    opacity: 0.3
                },
                yaxis: 'y',
                visible: document.getElementById('minor-walls').value === 'show'
            },
            // Volume/Net GEX
            {
                type: 'bar',
                x: volumeDates,
                y: volumeValues,
                name: 'Net GEX',
                yaxis: 'y2',
                marker: {
                    color: volumeValues.map(value => value >= 0 ? '#28a745' : '#dc3545')
                }
            },
            // Flag series for wiseguy alerts
            // Puts Bearish Flags
            {
                type: 'scatter',
                x: putsBearishFlags.map(flag => new Date(flag.x)),
                y: putsBearishFlags.map(flag => {
                    // Find the nearest candle close value for this timestamp
                    const timestamp = flag.x;
                    const index = findNearestCandleIndex(timestamp, candlesData);
                    return index !== -1 ? closes[index] : null;
                }),
                mode: 'markers+text',
                name: 'Puts Bearish',
                text: putsBearishFlags.map(flag => flag.title),
                textposition: 'top center',
                marker: {
                    symbol: 'triangle-down',
                    color: '#dc3545',
                    size: 10,
                    opacity: 0.7
                },
                hoverinfo: 'text',
                hovertext: putsBearishFlags.map(flag => flag.text),
                yaxis: 'y'
            },
            // Puts Bullish Flags
            {
                type: 'scatter',
                x: putsBullishFlags.map(flag => new Date(flag.x)),
                y: putsBullishFlags.map(flag => {
                    // Find the nearest candle close value for this timestamp
                    const timestamp = flag.x;
                    const index = findNearestCandleIndex(timestamp, candlesData);
                    return index !== -1 ? closes[index] : null;
                }),
                mode: 'markers+text',
                name: 'Puts Bullish',
                text: putsBullishFlags.map(flag => flag.title),
                textposition: 'top center',
                marker: {
                    symbol: 'triangle-up',
                    color: '#fd7e14',
                    size: 10,
                    opacity: 0.7
                },
                hoverinfo: 'text',
                hovertext: putsBullishFlags.map(flag => flag.text),
                yaxis: 'y'
            },
            // Calls Bearish Flags
            {
                type: 'scatter',
                x: callsBearishFlags.map(flag => new Date(flag.x)),
                y: callsBearishFlags.map(flag => {
                    // Find the nearest candle close value for this timestamp
                    const timestamp = flag.x;
                    const index = findNearestCandleIndex(timestamp, candlesData);
                    return index !== -1 ? closes[index] : null;
                }),
                mode: 'markers+text',
                name: 'Calls Bearish',
                text: callsBearishFlags.map(flag => flag.title),
                textposition: 'top center',
                marker: {
                    symbol: 'triangle-down',
                    color: '#6c757d',
                    size: 10,
                    opacity: 0.7
                },
                hoverinfo: 'text',
                hovertext: callsBearishFlags.map(flag => flag.text),
                yaxis: 'y'
            },
            // Calls Bullish Flags
            {
                type: 'scatter',
                x: callsBullishFlags.map(flag => new Date(flag.x)),
                y: callsBullishFlags.map(flag => {
                    // Find the nearest candle close value for this timestamp
                    const timestamp = flag.x;
                    const index = findNearestCandleIndex(timestamp, candlesData);
                    return index !== -1 ? closes[index] : null;
                }),
                mode: 'markers+text',
                name: 'Calls Bullish',
                text: callsBullishFlags.map(flag => flag.title),
                textposition: 'top center',
                marker: {
                    symbol: 'triangle-up',
                    color: '#28a745',
                    size: 10,
                    opacity: 0.7
                },
                hoverinfo: 'text',
                hovertext: callsBullishFlags.map(flag => flag.text),
                yaxis: 'y'
            }
        ];

        // Define layout
        const layout = {
            title: {
                text: `${currentTicker} GEXRay V2`,
                font: {
                    size: 18
                }
            },
            autosize: true,
            height: container.clientHeight,
            width: container.clientWidth,
            margin: {
                l: 50,
                r: 50,
                t: 50,
                b: 70
            },
            showlegend: true,
            legend: {
                orientation: 'h',
                y: 1.1
            },
            xaxis: {
                type: 'date',
                rangeslider: {
                    visible: false
                },
                title: 'Date/Time'
            },
            yaxis: {
                title: 'Price & Levels',
                domain: [0.3, 1],
                autorange: true
            },
            yaxis2: {
                title: 'Net GEX',
                domain: [0, 0.25],
                autorange: true
            },
            grid: {
                rows: 2,
                columns: 1,
                pattern: 'independent',
                roworder: 'top to bottom'
            },
            hovermode: 'closest',
            // Add theme-specific styling
            template: document.body.classList.contains('dark-mode') ? 'plotly_dark' : 'plotly'
        };

        // Config options
        const config = {
            responsive: true,
            scrollZoom: true,
            modeBarButtonsToAdd: [
                'hoverClosestGl2d',
                'toggleSpikelines',
                'resetScale2d'
            ],
            displaylogo: false
        };

        // Create the plot
        Plotly.newPlot('container', data, layout, config).then(function(plotChart) {
            // Store reference to the chart
            chart = plotChart;

            // Set up event handlers
            chart.on('plotly_click', function(data) {
                // Handle click events if needed
            });

            // Handle page visibility changes
            document.addEventListener('visibilitychange', function() {
                if (document.visibilityState === 'visible') {
                    // Page is visible again - only reconnect if the connection was lost
                    if (!source || source.readyState !== 1) {
                        // Reconnect if needed
                        initSSEConnection();
                    } else {
                        // Just update the status to confirm we're still connected
                        updateStatus(`Connected - Streaming ${currentTicker} data`);
                    }
                }
            });

            // Handle page unload
            window.addEventListener('beforeunload', function() {
                if (source) {
                    closeSseConnection();
                }
            });
        });

    } catch (error) {
        console.error("Error creating chart:", error);
        container.innerHTML = `
            <div style="color: white; text-align: center; padding: 20px;">
                Error creating chart: ${error.message}<br>
                Please check the console for more details.
            </div>
        `;
    }
}

// Helper function to find nearest candle for flag placement
function findNearestCandleIndex(timestamp, candlesData) {
    if (!candlesData || candlesData.length === 0) return -1;

    let nearestIndex = 0;
    let minDiff = Math.abs(timestamp - candlesData[0][0]);

    for (let i = 1; i < candlesData.length; i++) {
        const diff = Math.abs(timestamp - candlesData[i][0]);
        if (diff < minDiff) {
            minDiff = diff;
            nearestIndex = i;
        }
    }

    return nearestIndex;
}

// Initialize theme toggle
function initThemeToggle() {
    const themeToggle = document.getElementById('theme-toggle');

    if (!themeToggle) {
        console.error('Theme toggle element not found');
        return;
    }

    // Function to toggle theme
    function toggleTheme(isDark) {
        console.log('Toggling theme to', isDark ? 'dark' : 'light');

        // Apply dark mode class to body for page styling
        document.body.classList.toggle('dark-mode', isDark);

        // Save preference
        localStorage.setItem('darkMode', isDark);

        // If chart exists, update its template
        if (chart) {
            Plotly.relayout('container', {
                template: isDark ? 'plotly_dark' : 'plotly'
            });
        }
    }

    // Set initial state based on localStorage or system preference
    let initialDarkMode = localStorage.getItem('darkMode') === 'true';

    // If no preference is stored, check for system preference
    if (localStorage.getItem('darkMode') === null) {
        initialDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    // Set the toggle switch to match initial state
    themeToggle.checked = initialDarkMode;

    // Apply initial theme
    toggleTheme(initialDarkMode);

    // Add event listener for theme toggle
    themeToggle.addEventListener('change', function() {
        toggleTheme(this.checked);
    });
}