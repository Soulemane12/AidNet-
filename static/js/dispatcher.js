document.addEventListener('DOMContentLoaded', () => {
    const dispatcherForm = document.getElementById("dispatcher-form");
    const messageDiv = document.getElementById("dispatcher-message");
    const latitudeInput = document.getElementById("latitude");
    const longitudeInput = document.getElementById("longitude");
    const mapElement = document.getElementById('map');

    // Initialize Leaflet map with a default view
    const map = L.map('map').setView([0, 0], 13); // Will be updated to user's location

    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    let marker;

    // Function to update location on the map
    function updateLocation(position) {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;

        // Update hidden input values
        latitudeInput.value = lat;
        longitudeInput.value = lon;

        // If marker exists, update its position; otherwise, create a new marker
        if (marker) {
            marker.setLatLng([lat, lon]);
        } else {
            marker = L.marker([lat, lon], {
                draggable: true  // Make marker draggable
            }).addTo(map)
                .bindPopup("Emergency Location - Drag to adjust")
                .openPopup();

            // Add event listener for when marker is dragged
            marker.on('dragend', function(event) {
                const position = marker.getLatLng();
                latitudeInput.value = position.lat;
                longitudeInput.value = position.lng;
                // Update displayed coordinates
                document.getElementById('current-lat').textContent = position.lat.toFixed(6);
                document.getElementById('current-lon').textContent = position.lng.toFixed(6);
            });
        }

        // Center the map on the user's location
        map.setView([lat, lon], 13);
        
        // Update displayed coordinates
        document.getElementById('current-lat').textContent = lat.toFixed(6);
        document.getElementById('current-lon').textContent = lon.toFixed(6);
    }

    // Function to handle geolocation errors
    function handleLocationError(error) {
        switch(error.code) {
            case error.PERMISSION_DENIED:
                messageDiv.innerHTML = `<p style="color:red;">Geolocation permission denied. Unable to obtain your location.</p>`;
                break;
            case error.POSITION_UNAVAILABLE:
                messageDiv.innerHTML = `<p style="color:red;">Location information is unavailable.</p>`;
                break;
            case error.TIMEOUT:
                messageDiv.innerHTML = `<p style="color:red;">The request to get your location timed out.</p>`;
                break;
            case error.UNKNOWN_ERROR:
                messageDiv.innerHTML = `<p style="color:red;">An unknown error occurred while fetching your location.</p>`;
                break;
        }
    }

    // Request user's current location with high accuracy
    if (navigator.geolocation) {
        const options = {
            enableHighAccuracy: true,  // Request high accuracy
            timeout: 10000,            // Wait up to 10 seconds
            maximumAge: 0              // Don't use cached position
        };

        navigator.geolocation.getCurrentPosition(updateLocation, handleLocationError, options);

        // Watch position with same options
        navigator.geolocation.watchPosition(updateLocation, handleLocationError, options);
    } else {
        messageDiv.innerHTML = `<p style="color:red;">Geolocation is not supported by your browser.</p>`;
    }

    dispatcherForm.addEventListener("submit", (event) => {
        event.preventDefault();

        const symptoms = document.getElementById("symptoms").value;
        const lat = parseFloat(latitudeInput.value);
        const lon = parseFloat(longitudeInput.value);

        if (isNaN(lat) || isNaN(lon)) {
            messageDiv.innerHTML = `<p style="color:red;">Unable to obtain your location. Please ensure location services are enabled.</p>`;
            return;
        }

        // Prepare the data to be sent
        const emergencyData = {
            location: { lat, lon },
            symptoms
        };

        // For debugging: Display the JSON data
        console.log("Sending Emergency Data:", JSON.stringify(emergencyData, null, 2));

        fetch('/api/emergencies', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(emergencyData)
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                messageDiv.innerHTML = `<p style="color:red;">${data.error}</p>`;
            } else {
                messageDiv.innerHTML = `<p style="color:green;">${data.message}</p>`;
                dispatcherForm.reset();
                if (marker) {
                    map.removeLayer(marker);
                    marker = null;
                }
            }
        })
        .catch(error => {
            messageDiv.innerHTML = `<p style="color:red;">Error: ${error}</p>`;
        });
    });
});
