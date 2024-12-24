document.addEventListener('DOMContentLoaded', () => {
    const alertDetails = document.getElementById("alert-details");
    const emergencyList = document.getElementById("emergency-list");
    let currentEmergency = null;
    let routeControl = null;

    // Initialize map
    const map = L.map('map').setView([0, 0], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    // Add notification sound
    const alertSound = new Audio('/static/sounds/alert.mp3');

    // Function to display emergency on map
    function displayEmergencyOnMap(emergency) {
        const marker = L.marker([emergency.location.lat, emergency.location.lon])
            .addTo(map)
            .bindPopup(`
                Emergency ID: ${emergency.id}<br>
                Symptoms: ${emergency.symptoms}<br>
                Status: ${emergency.status}<br>
                ${emergency.responder ? 'Assigned to: ' + emergency.responder : 'Unassigned'}
            `)
            .openPopup();

        // Center map on the emergency
        map.setView([emergency.location.lat, emergency.location.lon], 13);
    }

    // Function to update emergency list and alerts
    function updateEmergencyList(emergencies) {
        const emergencyList = document.getElementById('emergency-list');
        const alertDetails = document.getElementById('alert-details');
        
        emergencyList.innerHTML = '';
        alertDetails.innerHTML = '';
        
        // Find the most recent pending emergency for the alert section
        const pendingEmergency = emergencies.find(e => e.status === 'pending');
        
        if (pendingEmergency) {
            alertDetails.innerHTML = `
                <div class="emergency-item pending" data-emergency-id="${pendingEmergency.id}">
                    <div class="status-badge pending">Pending Response</div>
                    <div class="emergency-details">
                        <span>📍 Location: (${pendingEmergency.location.lat}, ${pendingEmergency.location.lon})</span>
                        <span>⏰ Reported: ${new Date(pendingEmergency.timestamp).toLocaleString()}</span>
                        <span>🚨 Symptoms: ${pendingEmergency.symptoms}</span>
                    </div>
                    <div class="action-buttons">
                        <button class="accept-btn">Accept Call</button>
                        <button class="decline-btn">Decline</button>
                    </div>
                </div>
            `;
        } else {
            alertDetails.innerHTML = '<p>No active emergencies.</p>';
        }

        // Display all emergencies in the log
        emergencies.forEach(emergency => {
            const listItem = document.createElement('li');
            listItem.innerHTML = `
                <div class="emergency-item ${emergency.status}" data-emergency-id="${emergency.id}">
                    <div class="status-badge ${emergency.status}">${emergency.status.toUpperCase()}</div>
                    <div class="emergency-details">
                        <span>🆔 Emergency ID: ${emergency.id}</span>
                        <span>📍 Location: (${emergency.location.lat}, ${emergency.location.lon})</span>
                        <span>🚨 Symptoms: ${emergency.symptoms}</span>
                        <span>⏰ Time: ${new Date(emergency.timestamp).toLocaleString()}</span>
                        <span>📋 Status: ${emergency.status}</span>
                        ${emergency.responder ? `<span>👤 Assigned to: ${emergency.responder}</span>` : ''}
                    </div>
                </div>
            `;
            emergencyList.appendChild(listItem);
            displayEmergencyOnMap(emergency);
        });

        // Add clear button functionality
        const clearBtn = document.querySelector('.clear-btn');
        if (clearBtn) {
            clearBtn.onclick = () => clearEmergencyLog(emergencies);
        }
    }

    // Function to clear emergency log
    function clearEmergencyLog(emergencies) {
        const nonPendingEmergencies = emergencies.filter(e => e.status !== 'pending');
        if (nonPendingEmergencies.length > 0) {
            if (confirm('Are you sure you want to clear the emergency log? This will only clear resolved emergencies.')) {
                const emergencyIds = nonPendingEmergencies.map(e => e.id);
                
                fetch('/api/emergencies/clear', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        emergency_ids: emergencyIds
                    })
                })
                .then(response => response.json())
                .then(data => {
                    if (data.error) {
                        console.error('Error clearing emergencies:', data.error);
                    } else {
                        updateEmergencyList(data.emergencies);
                    }
                })
                .catch(error => {
                    console.error('Error clearing emergencies:', error);
                });
            }
        }
    }

    // Initialize Socket.IO
    const socket = io();

    // Register responder
    const responderId = localStorage.getItem('responderId') || 'responder-' + Date.now();
    localStorage.setItem('responderId', responderId);
    socket.emit('register', { responder_id: responderId });

    // Listen for new emergencies
    socket.on('new_emergency', (emergency) => {
        fetch('/api/emergencies')
            .then(response => response.json())
            .then(emergencies => {
                updateEmergencyList(emergencies);
            })
            .catch(error => {
                console.error('Error loading emergencies:', error);
            });
    });

    // Handle emergency response
    function handleEmergencyResponse(emergencyId, action) {
        const responderId = localStorage.getItem('responderId');
        
        fetch('/api/respond', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id: emergencyId,
                action: action,
                responder_id: responderId
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                alert(data.error);
            } else {
                // Refresh the emergency list
                fetch('/api/emergencies')
                    .then(response => response.json())
                    .then(emergencies => {
                        updateEmergencyList(emergencies);
                    });
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('Error responding to emergency');
        });
    }

    // Add distance calculation helper
    function calculateDistance(location) {
        if (!currentLocation) return "Unknown";
        return haversine(
            currentLocation.longitude,
            currentLocation.latitude,
            location.lon,
            location.lat
        ).toFixed(1);
    }

    // Add location tracking
    let currentLocation = null;
    if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition((position) => {
            currentLocation = {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude
            };
            
            // Update server with new location
            socket.emit('update_location', {
                responder_id: localStorage.getItem('responderId'),
                location: {
                    lat: currentLocation.latitude,
                    lon: currentLocation.longitude
                }
            });
        });
    }

    // Add click event listeners to accept/decline buttons
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('accept-btn')) {
            const emergencyItem = e.target.closest('.emergency-item');
            const emergencyId = parseInt(emergencyItem.dataset.emergencyId);
            handleEmergencyResponse(emergencyId, 'accept');
        } else if (e.target.classList.contains('decline-btn')) {
            const emergencyItem = e.target.closest('.emergency-item');
            const emergencyId = parseInt(emergencyItem.dataset.emergencyId);
            handleEmergencyResponse(emergencyId, 'decline');
        }
    });

    // Initial load of emergencies
    fetch('/api/emergencies')
        .then(response => response.json())
        .then(emergencies => {
            console.log('Loaded emergencies:', emergencies);
            updateEmergencyList(emergencies);
        })
        .catch(error => {
            console.error('Error loading emergencies:', error);
        });
});
