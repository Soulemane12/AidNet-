from flask import Flask, request, jsonify, render_template
from flask_socketio import SocketIO, emit, join_room, leave_room
import json
import os
from datetime import datetime
from math import radians, cos, sin, asin, sqrt

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app)

EMERGENCIES_FILE = 'emergencies.json'
RESPONDERS_FILE = 'responders.json'

# Load emergencies from JSON file
if os.path.exists(EMERGENCIES_FILE):
    with open(EMERGENCIES_FILE, 'r') as f:
        try:
            content = f.read().strip()
            emergencies = json.loads(content) if content else []
        except json.JSONDecodeError:
            emergencies = []
else:
    emergencies = []
    with open(EMERGENCIES_FILE, 'w') as f:
        json.dump([], f)

# Load responders from JSON file
if os.path.exists(RESPONDERS_FILE):
    with open(RESPONDERS_FILE, 'r') as f:
        try:
            content = f.read().strip()
            responders = json.loads(content) if content else []
        except json.JSONDecodeError:
            responders = []
else:
    responders = []
    with open(RESPONDERS_FILE, 'w') as f:
        json.dump([], f)

# Save emergencies to JSON file
def save_emergencies():
    with open(EMERGENCIES_FILE, 'w') as f:
        json.dump(emergencies, f, indent=4)

# Save responders to JSON file
def save_responders():
    with open(RESPONDERS_FILE, 'w') as f:
        json.dump(responders, f, indent=4)

# Calculate distance between two GPS coordinates in kilometers
def haversine(lon1, lat1, lon2, lat2):
    # Convert decimal degrees to radians 
    lon1, lat1, lon2, lat2 = map(radians, [lon1, lat1, lon2, lat2])

    # Haversine formula 
    dlon = lon2 - lon1 
    dlat = lat2 - lat1 
    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    c = 2 * asin(sqrt(a)) 
    r = 6371  # Radius of earth in kilometers
    return c * r

@app.route('/')
def home():
    return render_template('home.html')

# Routes to render pages
@app.route('/dispatcher')
def dispatcher():
    return render_template('dispatcher.html')

@app.route('/responder')
def responder():
    return render_template('responder.html')

# API to get emergencies
@app.route('/api/emergencies', methods=['GET'])
def get_emergencies():
    return jsonify(emergencies)

# API to create new emergency
@app.route('/api/emergencies', methods=['POST'])
def create_emergency():
    data = request.get_json()
    if not data or 'location' not in data or 'symptoms' not in data:
        return jsonify({'error': 'Invalid data'}), 400

    new_id = max([e['id'] for e in emergencies], default=0) + 1
    
    emergency = {
        'id': new_id,
        'location': data['location'],
        'symptoms': data['symptoms'],
        'status': 'pending',
        'timestamp': datetime.now().isoformat(),
        'responder': None,
        'severity': data.get('severity', 'unknown'),  # Add severity level
        'response_time': None,  # Track response time
        'confirmed_arrival': False  # Track if responder arrived
    }
    
    emergencies.append(emergency)
    save_emergencies()
    broadcast_emergency(emergency)
    
    return jsonify({
        'message': 'Emergency created successfully',
        'emergency': emergency
    }), 201

# Broadcast emergency to nearby responders via SocketIO
def broadcast_emergency(emergency):
    emergency_lat = emergency['location']['lat']
    emergency_lon = emergency['location']['lon']
    primary_radius = 5   # kilometers for immediate response
    secondary_radius = 10 # kilometers for backup responders
    
    print(f"Broadcasting emergency to responders. Active responders: {len(responders)}")

    # Sort responders by distance
    nearby_responders = []
    for responder in responders:
        try:
            responder_lat = responder['location']['lat']
            responder_lon = responder['location']['lon']
            distance = haversine(emergency_lon, emergency_lat, responder_lon, responder_lat)
            nearby_responders.append((responder, distance))
        except Exception as e:
            print(f"Error calculating distance for responder: {e}")
    
    # Sort by distance
    nearby_responders.sort(key=lambda x: x[1])
    
    # First try primary radius
    primary_sent = False
    for responder, distance in nearby_responders:
        if distance <= primary_radius:
            try:
                emergency['priority'] = 'high'
                socketio.emit('new_emergency', emergency, room=responder['id'])
                print(f"Sending primary alert to responder {responder['id']} at {distance:.2f}km")
                primary_sent = True
            except Exception as e:
                print(f"Error sending to primary responder: {e}")
    
    # If no close responders, try secondary radius
    if not primary_sent:
        for responder, distance in nearby_responders:
            if primary_radius < distance <= secondary_radius:
                try:
                    emergency['priority'] = 'medium'
                    socketio.emit('new_emergency', emergency, room=responder['id'])
                    print(f"Sending secondary alert to responder {responder['id']} at {distance:.2f}km")
                except Exception as e:
                    print(f"Error sending to secondary responder: {e}")

# API to respond to an emergency
@app.route('/api/respond', methods=['POST'])
def respond_emergency():
    data = request.get_json()
    if not data or 'id' not in data or 'action' not in data or 'responder_id' not in data:
        return jsonify({'error': 'Invalid data'}), 400
    emergency_id = data['id']
    action = data['action']  # 'accept' or 'decline'
    responder_id = data['responder_id']
    for emergency in emergencies:
        if emergency['id'] == emergency_id:
            if emergency['status'] != 'pending':
                return jsonify({'error': 'Emergency already responded'}), 400
            if action == 'accept':
                emergency['status'] = 'accepted'
                emergency['responder'] = responder_id
            elif action == 'decline':
                emergency['status'] = 'declined'
            else:
                return jsonify({'error': 'Invalid action'}), 400
            save_emergencies()
            return jsonify({'message': f'Emergency {action}ed', 'emergency': emergency}), 200
    return jsonify({'error': 'Emergency not found'}), 404

# Add this new route to handle clearing emergencies
@app.route('/api/emergencies/clear', methods=['POST'])
def clear_emergencies():
    data = request.get_json()
    if not data or 'emergency_ids' not in data:
        return jsonify({'error': 'Invalid data'}), 400
        
    emergency_ids = data['emergency_ids']
    
    # Keep only pending emergencies and emergencies not in the clear list
    global emergencies
    emergencies = [e for e in emergencies if e['status'] == 'pending' or e['id'] not in emergency_ids]
    
    # Save the updated emergencies list
    save_emergencies()
    
    return jsonify({
        'message': 'Emergencies cleared successfully',
        'emergencies': emergencies
    }), 200

# SocketIO event handlers
@socketio.on('connect')
def handle_connect():
    print('Client connected')

@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected')

@socketio.on('register')
def handle_register(data):
    responder_id = data.get('responder_id')
    if not responder_id:
        return
    
    print(f"Registering responder: {responder_id}")  # Debug log
    join_room(responder_id)
    
    # Add to responders list if not already present
    if not any(r['id'] == responder_id for r in responders):
        responders.append({'id': responder_id, 'status': 'available'})
        save_responders()
        print(f"Added new responder. Total responders: {len(responders)}")  # Debug log
    
    print(f"Responder {responder_id} joined room {responder_id}")
    emit('registration_success', {'message': 'Registered successfully'}, room=responder_id)

@socketio.on('update_location')
def handle_update_location(data):
    responder_id = data.get('responder_id')
    location = data.get('location')
    status = data.get('status', 'available')
    
    print(f"Updating location for responder: {responder_id}")  # Debug log
    
    if not responder_id or not location:
        return
        
    # Update responder's location and status
    for responder in responders:
        if responder['id'] == responder_id:
            responder['location'] = location
            responder['status'] = status
            save_responders()
            print(f"Updated responder location: {location}")  # Debug log
            break
    else:
        # If responder not found, add new responder
        responders.append({
            'id': responder_id,
            'location': location,
            'status': status
        })
        save_responders()
        print(f"Added new responder with location: {location}")  # Debug log

@socketio.on('request_emergency_updates')
def handle_request_emergency_updates():
    emit('emergencies', emergencies)

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
