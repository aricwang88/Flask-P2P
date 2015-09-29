(function(app) {
    /**
     * WebRTC Service
     * @return {Object} RTC
     */
     function MainCtrl($sce, Room) {
        var vm = MainCtrl.prototype;
        vm.peers = []; vm.roomUsers = []; vm.rooms = []; vm.messages = []; vm.users = []; vm.messages['Lobby'] = [];
        vm.currentUser = ''; vm.currentRoom = 'Lobby'; vm.connectionStatus = 'Not Connected';
        var username, message, can_close, channel, peerConnections, error;
        var sound = new Audio(document.location.origin + '/static/vendor/Sound.wav');
        var soundtwo = new Audio(document.location.origin + '/static/vendor/Sound2.wav');
        var soundthree = new Audio(document.location.origin + '/static/vendor/Sound3.wav');

        vm.getVideo = function(vidSrc) {
            return $sce.trustAsResourceUrl(vidSrc);
        };

        vm.getLoginForm = function() {
            setTimeout(function() {
                $('#myModal').modal({ backdrop: 'static'});
            }, 500);
        };

        vm.login = function() {
            var nick = $.trim(vm.currentUser);
            if(nick.length < 3) {
                toastr.warning('Your nickname must take 3 characters minimum');
                return;
            }
            if(!check(nick)) {
                toastr.warning('Your nickname contains illegal characters, please change it');
                return;
            }
            rtc.set_username(vm.currentUser);
        };

        vm.joinRoom = function(room) {
            rtc.join_room(room);
        };

        vm.addPeer = function(stream, username) {
            vm.getUsers();
            if(!vm.peers[vm.currentRoom]) {
                vm.peers[vm.currentRoom] = [];
            }
            var streamUrl = window.URL.createObjectURL(stream);
            var peerId = stream.id;
            var newPeer = {
                id: peerId,
                username: username,
                stream: streamUrl
            };
            var count = vm.peers[vm.currentRoom].filter(function(peer) {
               return (peer.username === newPeer.username);
            });
            if(count.length === 0) {
                vm.peers[vm.currentRoom].push(newPeer);
            }
        };

        vm.removePeer = function(user) {
            vm.getUsers();
            if(!vm.peers[vm.currentRoom]) {
                vm.peers[vm.currentRoom] = [];
            }
            var count = vm.peers[vm.currentRoom].filter(function(peer) {
                return (peer.username == user);
            });
            if(count.length > 0) {
                toastr.info('%0.'.f(user.bold()) + ' has leave room');
                vm.messages[vm.currentRoom].push({username: '' , content: user + ' has leave room' , type: 'info'});
            }
            vm.peers[vm.currentRoom] = vm.peers[vm.currentRoom].filter(function(peer) {
                return (peer.username !== user);
            });
        };

        vm.buzz = function() {
          	soundtwo.play();
        };

        vm.getRooms = function() {
            Room.getRooms()
            .success(function(data) {
                vm.rooms = data;
            })
            .error(function(data) {
                console.log(data);
            });
        };

        vm.getUsers = function() {
            if(vm.currentRoom === "")
                return;
            Room.getUsers(vm.currentRoom)
            .success(function(data) {
                vm.users[vm.currentRoom] = data;
            })
            .error(function(data) {
                console.log(data);
            });
        };

        vm.leaveOtherRooms = function(wantedRoom) {
            Room.leaveRooms(wantedRoom, vm.currentUser)
            .error(function(data) {
					      console.log(data);
            });
        };

        navigator.getUserMedia({"video": true, "audio": true},
            function(stream){
                document.getElementById('localVideo').src = window.URL.createObjectURL(stream);
                vm.currentStream = window.currStream = stream;
                vm.getLoginForm();
             },
             function(e){console.log(e);}
        );

        var check = function(str) {
            return (/^[a-zA-Z0-9- ]*$/.test(str));
        };

        var PeerConnection = window.RTCPeerConnection;
        var iceCandidate = window.RTCIceCandidate;
        var SessionDescription = window.RTCSessionDescription;
        var rtc_unsupported = 0;
        var reliable_false  = 1;
        var reliable_true   = 2;
        var rtc = {
            STUN_SERVERS: {
                iceServers: [{ url: 'stun:stun.l.google.com:19302' } ]
            },
            peerConnections: {},
            dataChannels: {},
            streams: [],
            socket: null,
            connected: false,
            me: null,
            room: null,
            _events: {},
            usernames: []
        };

        rtc.on = function(event, callback) {
            var events = event.split(' ');
            for (var x = 0; x < events.length; x++) {
                if (events[x].length === 0)
                    continue;
                rtc._events[events[x]] = rtc._events[events[x]] || [];
                rtc._events[events[x]].push(callback);
            }
            return this;
        };

        rtc.fire = function(event) {
            var events = event.split(' ');
            var args = Array.prototype.slice.call(arguments, 1);
            for (var x = 0; x < events.length; x++) {
                var callbacks = rtc._events[events[x]] || [];
                for(var y = 0; y < callbacks.length; y++)
                    callbacks[y].apply(null, args);
            }
            return this;
        };

        rtc.connect = function(stream_url) {

            rtc.stream = new EventSource(stream_url);
            rtc.stream_url = stream_url;
            rtc.fire('connecting');

            rtc.stream.onmessage = function(event) {
                var data = JSON.parse(event.data);
                rtc.fire('event_source_message', event);
                rtc.fire(data.event, data);
            };

            rtc.stream.onopen = function(event) {
                if (rtc.stream.readyState == 1) {
                    rtc.connected = true;
                    rtc.fire('connect', stream_url, event);
                }
            };

            rtc.stream.onerror = function(event) {
                if (rtc.stream.readyState != 1 && rtc.connected) {
                    rtc.connected = false;
                    if(rtc.dataChannels[username])
                        rtc.dataChannels[username].send(message);
                }
                rtc.fire('event_source_error', stream_url, event);
            };
        };

        rtc.emit = function(event, data) {
            var type = typeof data === 'string' ? data : 'post';
            return $.ajax({
                url: '%0/%1'.f(document.location.origin, event),
                data: data,
                dataType: 'json',
                type: type,
                headers: { "X-Stream-ID": rtc.stream_id }
            });
        };

        rtc.create_peer_connection = function(username) {
            var config;
            if (rtc.dataChannelSupport != rtc_unsupported) {
                config = rtc.dataChannelConfig;
            }
            var pc = rtc.peerConnections[username] = new PeerConnection(rtc.STUN_SERVERS, config);
            rtc.fire('new_peer_connection', username, config);

            pc.onicecandidate = function(event) {
                if (!event.candidate || event.candidate === null)
                    return;
                rtc.emit('send_ice_candidate', {
                    label: event.candidate.label,
                    candidate: JSON.stringify(event.candidate),
                    username: username
                });

                rtc.fire('ice_candidate', username, event.candidate, event);
                pc.onicecandidate = null;
            };

            pc.onopen = function() {
                rtc.fire('peer_connection_opened', username);
            };

            pc.onaddstream = function(event) {
                rtc.fire('add_remote_stream', username,  event.stream);
                vm.addPeer(event.stream, username);
            };

            pc.onremovestream = function(event) {
                rtc.fire('remove_peer_connected', username, event.stream);
            };

            pc.oniceconnectionstatechange = function(event) {
                if (event.target.iceConnectionState == 'connected') {
                    can_close = true;
                }
                if (event.target.iceConnectionState == 'disconnected') {
                    vm.removePeer(username);
                    rtc.fire('data_stream_close', username, channel);
                }
                rtc.fire('ice_state_change', event);
            };

            // (function() {
                pc.addStream(vm.currentStream);
            // });

            pc.ondatachannel = function (event) {
                rtc.add_data_channel(username, event.channel);
                rtc.fire('add_data_channel', username, event);
            };

            pc.onidpassertionerror = pc.onidpvalidationerror = function(e) {
                rtc.fire('pc_error', username, e);
            };
            return pc;
        };

        rtc.send_offer = function(username) {
            var pc = rtc.peerConnections[username];
            pc.createOffer( function(session_description) {
                pc.setLocalDescription(session_description, function() {
                    rtc.fire('set_local_description', username);
                }, function(error) {
                    rtc.fire('set_local_description_error', username, error);
                });

                rtc.emit('send_offer', {
                    username: username,
                        sdp: JSON.stringify(session_description)
                });
                rtc.fire('send_offer', username);
            }, function(error) {
                rtc.fire('send_offer_error', username, error);
            });
        };

        rtc.receive_offer = function(username, sdp) {
            var pc = rtc.peerConnections[username];
            var sdp_reply = new SessionDescription(JSON.parse(sdp));
            pc.setRemoteDescription(sdp_reply, function () {
                rtc.send_answer(username);
                rtc.fire('set_remote_description', username);
            },function(error){
                rtc.fire('set_remote_description_error', username, error);
            });
        };

        rtc.send_answer = function(username) {
            var pc = rtc.peerConnections[username];
            pc.createAnswer(function(session_description) {
                rtc.fire('send_offer', username);
                pc.setLocalDescription(session_description, function() {
                    rtc.emit('send_answer',{
                        username: username,
                        sdp: JSON.stringify(session_description)
                    });
                    rtc.fire('set_local_description', username);
                },function(error) {
                    rtc.fire('set_local_description_error', username, error);
                });
            }, function() {
                rtc.fire('send_offer_error'. username, error);
            });
        };

        rtc.receive_answer = function(username, sdp_in) {
            var pc = rtc.peerConnections[username];
            var sdp = new SessionDescription(JSON.parse(sdp_in));
            pc.setRemoteDescription(sdp, function() {
                rtc.fire('set_remote_description', username);
            },function() {
                rtc.fire('set_remote_description_error', username);
            });
        };

        rtc.create_data_channel = function(username, label) {
            var pc = rtc.peerConnections[username];
            label = label || String(username);
            if (rtc.dataChannelSupport == reliable_false) {
                return;
            }
            try {
                channel = pc.createDataChannel(label, { reliable: true });
            } catch (error) {
                rtc.fire('data_channel_error', username, error);
                throw error;
            }
            return rtc.add_data_channel(username, channel);
        };

        rtc.add_data_channel = function(username, channel) {
            channel.onopen = function() {
                channel.binaryType = 'arraybuffer';
                rtc.connected[username] = true;
                rtc.fire('data_stream_open', username);
                vm.getUsers();
            };

            channel.onclose = function(event) {
								event = event;
              	delete rtc.dataChannels[username];
                vm.removePeer(username);
                rtc.fire('data_stream_close', username, channel);
            };

            channel.onmessage = function(message) {
                rtc.fire('data_stream_data', username, message);
                rtc.fire('message', username, message.data);
            };

            channel.onerror = function(error) {
                rtc.fire('data_stream_error', username, error);
            };

            rtc.dataChannels[username] = channel;
            rtc.fire('data_channel_added', username);
            return channel;
        };

        rtc.add_streams = function() {
            for (var i = 0; i < rtc.streams.length; i++) {
                var stream = rtc.streams[i];
              	for (var connection in rtc.peerConnections) {
                  	if (rtc.hasOwnProperty(peerConnections)) {
               		  		rtc.peerConnections[connection].addStream(stream);
                    }
                }
            }
        };

        rtc.attach_stream = function(stream, dom_id) {
            document.getElementById(dom_id).src = window.URL.createObjectURL(stream);
        };

        rtc.send = function(message) {
            for (var x = 0; x < rtc.usernames.length; x++) {
                var username = rtc.usernames[x];
                if(rtc.dataChannels[username] && rtc.dataChannels[username].readyState == 'open')
                    rtc.dataChannels[username].send(message);

            }
            rtc.fire('message', rtc.username, message.sanitize());
        };

        rtc.join_room = function(room) {
            if(vm.currentRoom !== ''){
                if(room == rtc.room || room == vm.currentRoom) {
                    return toastr.warning('You are already in this room');
                }
                vm.leaveOtherRooms(room);
            }
            if (rtc.connected)
                rtc.emit('join_room', { room: room, encryption: null })
                    .done(function(json) {
                       sound.play();
                       rtc.room = room;
                       vm.getRooms();
                       vm.currentRoom = room;
                       vm.getUsers();
                       vm.messages[vm.currentRoom] = [];
                        rtc.fire('joined_room', room)
                           .fire('get_peers', json);
                    });
        };

        rtc.set_username = function(username) {
            if (rtc.connected) {
                rtc.emit('set_username', { username: username })
                    .done(function() {
                        rtc.username = username;
                        rtc.fire('set_username_success', username);
                        setTimeout(function () {
                          $('#myModal').modal('hide');
                      }, 500);

                    })
                    .fail(function(error) {
                        vm.currentUser = '';
                        if(error.responseText == '{"error": "Username already in use"}')
                            toastr.error('Nom d\'utilisateur déjà pris');
                        rtc.fire('set_username_error', username, error);
                    });
            }
        };

        rtc.packet_inbound = function(username, message) {
            message = message.sanitize();
            rtc.fire('message', username, message, true);
        };

        /* WebRTC SSE Callbacks */
        rtc.on('connect', function() {
            rtc.connected = true;
            if (rtc.username)
                rtc.set_username(rtc.username);
        })

        .on('hello', function(data) {
            rtc.stream_id = data.stream_id;
        })

        .on('disconnect', function() {
            rtc.connected = false;
        })

        .on('get_peers', function(data) {
            var usernames = [];
            for (var i = 0, len = data.users.length; i < len; i++) {
                var user  = data.users[i];
                var username = user.username = user.username.sanitize();
                usernames.push(username);
                rtc.create_peer_connection(username);
                rtc.create_data_channel(username);
                rtc.send_offer(username);
            }
            rtc.usernames = usernames;
            rtc.users = data.users;
            rtc.first_connect = true;
            rtc.fire('got_peers', data);
            rtc.first_connect = false;
        })

        .on('set_username_success', function() {
            if (rtc.room)
                rtc.join_room(rtc.room);
        })

        .on('user_join', function(data) {
            rtc.usernames.push(data.username);
            rtc.create_peer_connection(data.username);
            var pc = rtc.create_peer_connection(data.username);
            for (var i = 0; i < rtc.streams.length; i++) {
                var stream = rtc.streams[i];
                pc.addStream(stream);
           }
        })

        .on('remove_peer_connected', function(data) {
            rtc.connected[data.username] = false;
            rtc.fire('disconnect stream', data.username, rtc.usernames[data.username]);
            delete rtc.dataChannels[data.username];
            delete rtc.usernames[data.username];
            delete rtc.peerConnections[data.username];
        })

        .on('receive_ice_candidate', function(data) {
            var candidate = new iceCandidate(JSON.parse(data.candidate));
            rtc.peerConnections[data.username].addIceCandidate(candidate);
        })
        .on('receive_offer', function(data) {
            rtc.receive_offer(data.username, data.sdp);
        })
        .on('receive_answer', function(data) {
            rtc.receive_answer(data.username, data.sdp);
        })
        .on('user_leave', function(data) {
            var leaveUser = data.username ? data.username  : '';
            vm.removePeer(leaveUser);
        });

        rtc.dataChannelConfig = {optional: [ {'DtlsSrtpKeyAgreement': true} ] };
        // Check if Data Channel is supported
        try {
            var pc = new PeerConnection(rtc.STUN_SERVERS, rtc.dataChannelConfig);
            channel = pc.createDataChannel('supportCheck', { reliable: true });
            channel.close();
            rtc.dataChannelSupport = reliable_true;
        } catch(e) {
            try {
                var pc = new PeerConnection(rtc.STUN_SERVERS, rtc.dataChannelConfig);
                channel = pc.createDataChannel('supportCheck', { reliable: false });
                channel.close();
                rtc.dataChannelSupport = reliable_false;
            } catch(e) {
                rtc.dataChannelSupport = rtc_unsupported;
            }
        }
        rtc.fire('data_channel_reliability');

        var $cont = $('#messages');
        var connection_icon = document.getElementById('connection_icon');
        var buffer_input = document.getElementById('buffer_input');
        var base_connection_icon = 'fa fa-circle ';

        rtc.on('connecting', function() {
            vm.connectionStatus = 'Connecting...';
            connection_icon.setAttribute('class', base_connection_icon + 'connecting');
        })
        .on ('connect', function() {
            vm.connectionStatus = 'Connected';
            connection_icon.setAttribute('class', base_connection_icon + 'online');
            toastr.info('Connected.');
        })
        .on('disconnect', function() {
            vm.connectionStatus = 'Disconnected';
            connection_icon.setAttribute('class', base_connection_icon + 'offline');
        })
        .on ('set_username_success', function() {
            toastr.success('Username successfully set to %0.'.f(rtc.username.bold()));
        })
        .on('joined_room', function() {
            vm.currentRoom = rtc.room;
        })
        .on ('got_peers', function() {
            if (rtc.first_connect)
                toastr.info('Entered ' + rtc.room);

          if (rtc.usernames.length === 0)
                return toastr.info('You are the only user in this room.');

            var users = '';
            for (var x = 0; x < rtc.usernames.length; x++) {
                users += rtc.usernames[x].bold() + ' ';
            }
            toastr.info('Users in room: ' + users);
        })
        .on('user_join', function(data) {
            toastr.info('User %0 has joined.'.f(data.username.bold()));
        })
        .on('message', function(username, message) {
            vm.getUsers();
            message = { content: message, username: username, time: getTime() };
            var currentRoom = vm.currentRoom;
            if(currentRoom === 'Lobby') {
                vm.messages[currentRoom].push(message);
                return;
            }
            var count = vm.users[vm.currentRoom].filter(function(user) {
                return (user == username);
            });
            if(count.length > 0){
                vm.messages[currentRoom].push(message);
            }
            $cont[0].scrollTop = $cont[0].scrollHeight;
            if(username != vm.currentUser){
               soundthree.play();
            }
        });
        $cont[0].scrollTop = $cont[0].scrollHeight;
        $('#buffer_input').keyup(function(e) {
            if (e.keyCode == 13)
                $cont[0].scrollTop = $cont[0].scrollHeight;
        });

        buffer_input.addEventListener('keydown', function(event) {
            if (event.keyCode != 13)
                return;
            event.preventDefault();
            var input = buffer_input.value;
            $(buffer_input).val('');
            setTimeout(function() {
                $(buffer_input).val('');
            },1);
            if (input.length === 0)
                return;
            rtc.send(input);
            return false;
        });

        $('#createRoom').keydown(function(event) {
            var room = $(this).val();
            if(event.keyCode == 13) {
                if(!check(room)){
                    toastr.warning('The name contains illegal characters, please change it');
                    return;
                }
                vm.joinRoom(room);
                $(this).val('');
            }
        });

        $('#submitRoom').click(function() {
            var room = $('#createRoom').val();
            console.log(room);
            if(!check(room)){
                toastr.warning('The name contains illegal characters, please change it');
                return;
            }
            vm.joinRoom(room);
            $('#createRoom').val('');
        });

        window.rtc = rtc;
        rtc.connect(document.location.origin + '/stream');
        console.log(MainCtrl.prototype);

    };

    /**
     * Log service
     * @param  {Object} rtc
     */
    function LogCtrl($log) {
        var log = this;
        rtc.log_data_stream_data = false;
        rtc.log_heartbeat = false;
        rtc.log_event_source_message = true;

        this.apply = function() {
            var params = Array.prototype.slice.call(arguments, 0);
            var type = params[0];
            var args = params.slice(1);
            args.unshift(getTime());
            var toExec = "$log."+ type + ".apply(console, args)";
            eval(toExec);
            return;
        };

        rtc.on('error', function(error) {
            log.apply('warning', '[ERROR] ' + error);
        })

        // EventSource
        .on('connect', function(stream_url) {
            log.apply('log', 'Connected to ' + stream_url);
        })
        .on('connecting', function(stream_url) {
            log.apply('log', 'Connecting to ' + stream_url);
        })
        .on('disconnect', function(stream_url) {
            log.apply('log', 'Disconnected from ' + stream_url);
        })
        .on('event_source_error', function(event) {
            log.apply('warn', 'Event source error', event);
        })
        .on('event_source_message', function(event) {
            var data = JSON.parse(event.data);
            if ((data.event === 'heartbeat' && !rtc.log_heartbeat) || !rtc.log_event_source_message)
                return;
            log.apply('log', 'Event source message', event);
        })
        .on('hello', function() {
            log.apply('log', 'Got hello packet!');
        })

        // WebRTC Events
        .on('new_peer_connection', function(username, config) {
            log.apply('info', 'new PeerConnection for ' + username, config);
        })
        .on('ice_candidate', function(username, candidate, event) {
            log.apply('info','ICE Candidate ' + username, candidate, event);
        })
        .on('peer_connection_opened', function(username) {
            log.apply('info', 'PeerConnection opened for ' + username);
        })
        .on('ice_state_change', function(event) {
            log.apply('info', 'new ICE state: ' + event.target.iceConnectionState, event);
        })
        .on('add_data_channel', function(username, event) {
            log.apply('info', 'Added Data Channel for ' + username, event);
        })
        .on('pc_error', function(username, event) {
            log.apply('warn', 'Peer connection error with ' + username, event);
        })
        .on('set_local_description', function(username) {
            log.apply('log', 'Set LocalDescription for ' + username);
        })
        .on('set_local_description_error', function() {
            log.apply('warn', 'Set LocalDescription error with ');
        })
        .on('send_offer', function(username) {
            log.apply('log', 'Sent PC offer to ' + username);
        })
        .on('send_offer_error', function(username, error) {
            log.apply('warn', 'PC offer error with ' + username, error);
        })
        .on('receive_offer', function(username, sdp) {
            log.apply('log', 'received PC offer from ' + username, sdp);
        })
        .on('receive_answer', function(username, sdp_in) {
            log.apply('log', 'received PC answer from ' + username, sdp_in);
        })
        .on('set_remote_description', function(username) {
            log.apply('info', 'Set RemoteDescription for '+ username);
        })
        .on('set_remote_description_error', function(username, error) {
            log.apply('warn', 'RemoteDescription error with ' + username, error);
        })
        .on('data_channel_added', function(username, label) {
            log.apply('info', 'added DataChannel with %0 labeled "%1"'.f(username, label));
        })
        .on('data_channel_error', function(username, error) {
            log.apply('warn', 'DataChannel error with %0: %1'.f(username, error));
        })
        .on('data_stream_open', function(username) {
            log.apply('info', 'DataChannel opened for ' + username);
        })
        .on('data_stream_close', function(username) {
            log.apply('info', 'DataStream closed for ' + username);
        })
        .on('data_stream_data', function(username, message) {
            if (rtc.log_data_stream_data)
                log.apply('log', 'received data from '+ username +': ' + 'message');
        })
        .on('data_channel_reliable', function() {
            log.apply('info', 'Data channel reliability set to ');
        })
        .on('get_peers', function(data) {
            log.apply('log', 'get_peers', data);
        })
        .on('joined_room', function(room) {
            log.apply('info', 'joined room: ' + room);
        })
        .on('user_join', function(data) {
            log.apply('info', data.username + ' has joined the room');
        })
        .on('set_username_success', function(username) {
            log.apply('log', 'successfuly set username to ' + username);
        })
        .on('set_username_error', function(username) {
            log.apply('warn', 'failed to set username to ' + username);
        });
    };

    app.controller('MainController', MainCtrl);
    app.controller('LogController', LogCtrl);

})(angular.module('MainCtrl', []));
