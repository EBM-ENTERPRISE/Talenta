#!/bin/bash

# Function to check if Docker is running
check_docker() {
    docker info > /dev/null 2>&1
}

# Ensure Docker is running
ensure_docker_running() {
    if ! check_docker; then
        echo "Docker is not running. Attempting to start Docker Desktop..."
        open -a Docker
        
        echo "Waiting for Docker to start (this may take a minute)..."
        echo "PLEASE APPROVE ANY POPUPS ON YOUR SCREEN."
        
        while ! check_docker; do
            sleep 2
            echo -n "."
        done
        echo ""
        echo "Docker is now running!"
    else
        echo "Docker is already running."
    fi
}

# --- Command Handler ---
COMMAND=$1

case "$COMMAND" in
    "start"|"")
        ensure_docker_running
        echo "Starting Distributed System..."
        docker-compose down --remove-orphans # Cleanup old
        docker-compose up -d --build --remove-orphans
        
        echo ""
        echo "=================================================="
        echo "Distributed System Started!"
        echo "Main Load Balancer: http://localhost:9090"
        echo ""
        echo "Direct Access Points:"
        echo "  - Frontend 1: http://localhost:3051 (Uses Backend 1)"
        echo "  - Frontend 2: http://localhost:3052 (Uses Backend 2)"
        echo "  - Backend 1:  http://localhost:3061 (Proxy to Supabase 1)"
        echo "  - Backend 2:  http://localhost:3062 (Proxy to Supabase 2)"
        echo "=================================================="
        ;;
        
    "stop")
        echo "Stopping Distributed System..."
        docker-compose down --remove-orphans
        echo "System Stopped."
        ;;
        
    "toggle")
        # Check if any containers are running
        if [ "$(docker-compose ps -q)" ]; then
            echo "System is RUNNING. Stopping it now..."
            docker-compose down --remove-orphans
            echo "System Stopped."
        else
            echo "System is STOPPED. Starting it now..."
            ensure_docker_running
            docker-compose up -d --build --remove-orphans
            echo "System Started!"
        fi
        ;;
        
    *)
        echo "Usage: ./start.sh [start|stop|toggle]"
        echo "  start  - Start the system (default)"
        echo "  stop   - Stop the system"
        echo "  toggle - Toggle system state (on/off)"
        ;;
esac
