(function (app) {
    app.run(function($rootScope) {
        $rootScope.messages = [];
    });
})(angular.module('app', ['MainCtrl', 'RoomService'], function($interpolateProvider) {
    $interpolateProvider.startSymbol('<%');
    $interpolateProvider.endSymbol('%>');
}));

(function(app) {
    app.controller('MainController', function ($sce, $rootScope, $scope, $filter, Room) {

        $scope.peers = [];
        $scope.currentUser = ''
        $scope.roomUsers = [];
        $scope.rooms = [];
        $scope.currentRoom = '';

        navigator.getUserMedia({"video": true, "audio": false},
            function(stream){
                document.getElementById('localVideo').src = window.URL.createObjectURL(stream);
                console.log(stream, 'STREAMVIDEO');
                $scope.currentStream = stream;
             },
             function(e){console.log(e);}
        );

        $scope.getVideo = function(vidSrc) {
          return $sce.trustAsResourceUrl(vidSrc);
        };

        $scope.addPeer = function(stream, username) {
            var streamUrl = window.URL.createObjectURL(stream);
            var peerId = stream.id;
            $scope.currentStream = stream.id;
            var newPeer = {
                id: peerId,
                username: username,
                stream: streamUrl
            };
            var count = $scope.peers.filter(function(peer){
               return (peer.username === newPeer.username)
            });
            if(count.length === 0) {
                $scope.peers.push(newPeer);
            }

            $scope.$apply();
        };

        $scope.getRooms = function() {
            Room.getRooms()
              .success(function(data){
                  $scope.rooms = data;
              })
              .error(function(data){
                  console.log(data);
              })
        };

        /**
         * WebRTC Service
         * @return {Object} rtc
         */
        ;(function() {
            ;(function(strings, regex) {
                //Parse string
                strings.f = function () {
                    var args = arguments;
                    return this.replace(regex, function(token) {
                        var index = parseInt(token.substring(1, token.length ));
                        if (index >= 0 && args[index]) {
                            return args[index];
                        } else if (token === '%%') {
                            return '%';
                        }
                        return "";
                    });
                };
                // Bold a string
                strings.bold = function() {
                    return "<strong>%0</strong>".f(this);
                }
                 // Converts a string into a unique number based off the sum of the character code values of each character.
                strings.toID = function() {
                    var id = 0;
                    for (var x = 0; x < this.length; x++)
                        id += this.charCodeAt(x);
                    return id;
                }
                // Sanitize stings for avoid XSS
                strings.sanitize = function() {
                    return this.replace(/[\<\>''\/]/g, function(c) {
                        var sanitize_replace = {
                            '<' : '&lt;',
                            '>' : '&gt;',
                            "'" : '&quot;',
                            "'" : '&#x27;',
                            '/' : '&#x2F;'
                        }
                        return sanitize_replace[c];
                    });
                }
            })(String.prototype, /%(\d+)|%%/g);

            // Determine the correct RTC functions and classes
            var PeerConnection = window.RTCPeerConnection;
            var iceCandidate = window.RTCIceCandidate;
            var SessionDescription = window.RTCSessionDescription;
            var rtc_unsupported = 0;
            var reliable_false  = 1;
            var reliable_true   = 2;
            var sent_no_otr   = 0;
            var sent_some_otr = 1;
            var sent_all_otr  = 2;
            var received      = 0;
            var received_otr  = 2;
            var rtc = {
                STUN_SERVERS: {
                    iceServers: [{ url: 'stun:stun.l.google.com:19302' } ]
                },
                peerConnections: {},
                dataChannels: {},
                connected: {},
                streams: [],
                socket: null,
                connected: false,
                me: null,
                room: null,
                _events: {},
                using_otr: false
            };

            /*
             * Set callback(s) for space-deliminated event string.
             */
            rtc.on = function(event, callback) {
                var events = event.split(' ');
                for (var x = 0; x < events.length; x++) {
                    if (events[x].length == 0)
                        continue;
                    rtc._events[events[x]] = rtc._events[events[x]] || [];
                    rtc._events[events[x]].push(callback);
                }
                return this;
            }

            /*
             * Fire callback(s) for space-deliminated event string.
             */
            rtc.fire = function(event/* ... args */) {
                var events = event.split(' ');
                var args = Array.prototype.slice.call(arguments, 1);

                for (var x = 0; x < events.length; x++) {
                    var callbacks = rtc._events[events[x]] || [];
                    for(var y = 0; y < callbacks.length; y++)
                        callbacks[y].apply(null, args)
                }
                return this;
            }

            /*
             * Connects to the SSE source.
             */
            rtc.connect = function(stream_url) {

                rtc.stream = new EventSource(stream_url);
                rtc.stream_url = stream_url;
                rtc.fire('connecting');

                rtc.stream.onmessage = function(event) {
                    var data = JSON.parse(event.data);
                    rtc.fire('event_source_message', event);
                    rtc.fire(data.event, data);
                }

                rtc.stream.onopen = function(event) {
                    if (rtc.stream.readyState == 1) {
                        rtc.connected = true;
                        rtc.fire('connect', stream_url, event);
                    }
                }

                rtc.stream.onerror = function(event) {
                    if (rtc.stream.readyState != 1 && rtc.connected) {
                        rtc.connected = false;
                        rtc.fire('disconnect', stream_url);
                    }
                    rtc.fire('event_source_error', stream_url, event);
                }
            }

            /*
             * Emit a request (event) to the server.
             */
            rtc.emit = function(event, data) {
                var type = typeof data === 'string' ? data : 'post';
                return $.ajax({
                    url: '%0/%1'.f(document.location.origin, event),
                    data: data,
                    dataType: 'json',
                    type: type,
                    headers: { "X-Stream-ID": rtc.stream_id }
                });
            }

            /*
             * Creates a new peerConnection object for a given username.
             */
            rtc.create_peer_connection = function(username) {

                var config;
                if (rtc.dataChannelSupport != rtc_unsupported) {
                    config = rtc.dataChannelConfig;
                }
                var pc = rtc.peerConnections[username] = new PeerConnection(rtc.STUN_SERVERS, config);
                rtc.fire('new_peer_connection', username, config);

                pc.onicecandidate = function(event) {
                    if (event.candidate == null)
                        return

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
                    $scope.addPeer(event.stream, username);
                };

                pc.oniceconnectionstatechange = function(event) {
                    if (event.target.iceConnectionState == 'connected') {
                        can_close = true; /* TODO! - make per channel */
                    }
                    rtc.fire('ice_state_change', event);
                }

                $(function(){
                    currentStream = $scope.currentStream;
                    console.log(currentStream);
                    pc.addStream(currentStream);
                })

                pc.ondatachannel = function (event) {
                    rtc.add_data_channel(username, event.channel);
                    rtc.fire('add_data_channel', username, event);
                }
                pc.onidpassertionerror = pc.onidpvalidationerror = function(e) {
                    rtc.fire('pc_error', username, e)
                }
                return pc;
            }

            /*
             * Send intial WebRTC peerConnection offer.
             */
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
            }

            /*
             * Receive intial WebRTC peerConnection offer.
             */
            rtc.receive_offer = function(username, sdp) {
                var pc = rtc.peerConnections[username];
                var sdp_reply = new SessionDescription(JSON.parse(sdp));
                pc.setRemoteDescription(sdp_reply, function () {
                    rtc.send_answer(username);
                    rtc.fire('set_remote_description', username);
                },function(error){
                    rtc.fire('set_remote_description_error', username, error);
                });
            }

            /*
             * Send WebRTC peerConnection answer back to user who sent offer.
             */
            rtc.send_answer = function(username) {
                var pc = rtc.peerConnections[username];

                pc.createAnswer(function(session_description) {
                    rtc.fire('send_offer', username)
                    pc.setLocalDescription(session_description, function() {
                        rtc.emit('send_answer',{
                            username: username,
                            sdp: JSON.stringify(session_description)
                        });
                        rtc.fire('set_local_description', username)
                    },function(err) {
                        rtc.fire('set_local_description_error', username, err);
                    });
                }, function(e) {
                    rtc.fire('send_offer_error'. username, err);
                });
            }

            /*
             * The user who sent original WebRTC offer receives final answer.
             */
            rtc.receive_answer = function(username, sdp_in) {
                var pc = rtc.peerConnections[username];
                var sdp = new SessionDescription(JSON.parse(sdp_in));
                pc.setRemoteDescription(sdp, function() {
                    rtc.fire('set_remote_description', username);
                },function(err) {
                    rtc.fire('set_remote_description_error', username)
                });
            }

            /*
             * Creates a dataChannel instance for a peer.
             */
            rtc.create_data_channel = function(username, label) {
                var pc = rtc.peerConnections[username];
                var label = label || String(username);
                if (rtc.dataChannelSupport == reliable_false) {
                    return;
                }
                try {
                    channel = pc.createDataChannel(label, { reliable: true });
                } catch (error) {
                    rtc.fire('data_channel_error', username, error)
                    throw error;
                }
                return rtc.add_data_channel(username, channel);
            };

            /*
             * Adds callbacks to a dataChannel and stores the dataChannel.
             */
            rtc.add_data_channel = function(username, channel) {
                channel.onopen = function() {
                    channel.binaryType = 'arraybuffer';
                    rtc.connected[username] = true;
                    rtc.fire('data_stream_open', username);
                };

                channel.onclose = function(event) {
                    delete rtc.dataChannels[username];
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
                rtc.fire('data_channel_added', username, channel)
                return channel;
            }

            rtc.add_streams = function() {
                for (var i = 0; i < rtc.streams.length; i++) {
                    var stream = rtc.streams[i];
                    for (var connection in rtc.peerConnections) {
                        rtc.peerConnections[connection].addStream(stream);
                    }
                }
            }

            rtc.attach_stream = function(stream, dom_id) {
                document.getElementById(dom_id).src = window.URL.createObjectURL(stream);
            }

            rtc.send = function(message) {
                for (var x = 0; x < rtc.usernames.length; x++) {
                    var username = rtc.usernames[x];
                    if(rtc.dataChannels[username])
                    rtc.dataChannels[username].send(message);
                }
                rtc.fire('message', rtc.username, message.sanitize(), sent_all_otr);
            }

            rtc.join_room = function(room) {
                rtc.room = room;
                if (rtc.connected)
                    rtc.emit('join_room', { room: room, encryption: null })
                        .done(function(json) {
                            rtc.fire('joined_room', room)
                               .fire('get_peers', json);
                               $scope.getRooms();
                        })
                ;
            }

            rtc.set_username = function(username) {
                rtc.username = username;
                if (rtc.connected)
                    rtc.emit('set_username', { username: username })
                        .done(function() {
                            rtc.fire('set_username_success', username);
                        })
                        .fail(function(error) {
                            rtc.fire('set_username_error', username, error)
                        })
                    ;
            }

            rtc.packet_inbound = function(username, message) {
                message = message.sanitize();
                rtc.fire('message', username, message, true);
            }

            /* WebRTC SSE Callbacks */
            rtc.on('connect', function() {
                rtc.connected = true;
                if (rtc.username)
                    rtc.set_username(rtc.username);
            })

            .on('hello', function(data) {
                rtc.stream_id = data.stream_id
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
                rtc.first_connect = true
                rtc.fire('got_peers', data);
                rtc.first_connect = false;
            })

            .on('set_username_success', function(data) {
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

            rtc.dataChannelConfig = {optional: [ {'DtlsSrtpKeyAgreement': true} ] };

            // Determine Data Channel support
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

            //DOM INTERACTIONS (TO BE REMOVED USING ANGULAR SCOPE);
            var username_span = document.getElementById('username');
            var user_icon = document.getElementById('user_icon');
            var room_name = document.getElementById('room_name');
            var room_icon = document.getElementById('room_icon');
            var connection_status_div = document.getElementById('connection_status');
            var connection_icon = document.getElementById('connection_icon');
            var messages_div = document.getElementById('messages');
            var buffer_input = document.getElementById('buffer_input');
            var base_connection_icon = 'fa fa-circle ';
            var levels = ['success', 'error', 'operation', 'info']
            var print = {
                out: function(message, type) {
                    var message_div = document.createElement('div');
                    message_div.setAttribute('class','message ' + type);
                    message_div.innerHTML = message;
                    messages_div.appendChild(message_div);
                    messages.scrollTop = messages_div.scrollHeight;
                }
            }
            rtc.print = print;
            for (var x = 0; x < levels.length; x++)
                print[levels[x]] = (function(level) { return function(message) { print.out(message, level)}})(levels[x]);

            rtc.on('connecting', function() {
                connection_status_div.innerHTML = 'Connecting...';
                connection_icon.setAttribute('class', base_connection_icon + 'connecting');
                print.operation('Connecting to %0...'.f(rtc.stream_url));
            })
            .on ('connect', function() {
                connection_status_div.innerHTML = 'Connected';
                connection_icon.setAttribute('class', base_connection_icon + 'online');
                print.success('Connected.');
                print.info('Set your username with the %0 command. ex: %0 your_name'.f('/nick'.bold()));
                print.info('Set OTR encryption with %0 command. ex: %0 something_secret'.f('/secret'.bold()));
                print.info('Join a chatroom with the %0 command. ex: %0 the_meeting_spot'.f('/join'.bold()));
            })
            .on('disconnect', function() {
                connection_status_div.innerHTML = 'Disconnected';
                connection_icon.setAttribute('class', base_connection_icon + 'offline');
            })
            .on ('set_username_success', function() {
                print.success('Username successfully set to %0.'.f(rtc.username.bold()));
                username_span.innerHTML = rtc.username;
            })
            .on ('set_username_error', function(data) {
                print.error('Failed to set username: %0.'.f(data.error));
                buffer_input.value = '/nick ' + data.username;
            })
            .on('joined_room', function() {
                $(room_name).html(rtc.room);
            })
            .on ('got_peers', function(data) {
                if (rtc.first_connect)
                    print.info('Entered ' + rtc.room);

                if (rtc.usernames.length == 0)
                    return print.info('You are the only user in this room.');

                var users = '';
                for (var x = 0; x < rtc.usernames.length; x++) {
                    users += rtc.usernames[x].bold() + ' ';
                }
                print.info('Users in room: ' + users);
            })
            .on('user_join', function(data) {
                print.info('User %0 has joined.'.f(data.username.bold()));
            })
            .on('message', function(username, message, otr_status) {
                var $message = $(
                    '<div class="message">' +
                        '<span class="fa fa-lock"></span>' +
                        '<span class="chat-user">%0:</span>'.f(username.bold()) +
                        '<span class="message-inner">%0</span>'.f(message) +
                    '</div>'
                ).appendTo(messages_div);
            })
            .on('send_offer', function(username) {
                print.operation('Sending RTC offer to %0...'.f(username.bold()));
            })
            .on('send_offer_error', function(username) {
                print,error('Failed to send RTC offer to %0.'.f(username.bold()));
            })
            .on ('receive_offer receive_answer', function(data) {
                print.success('Received RTC offer from %0.'.f(data.username.bold()));
            })

            .on('set_local_description', function(username) {
                print.success('Set local description for %0.'.f(username.bold()));
            })
            .on('set_local_description_error', function(username, error) {
                print.error('Failed to set local description for %0!'.f(username.bold()));
            })
            .on('set_remote_description', function(username) {
                print.success('Set remote description for %0.'.f(username.bold()));
            })
            .on('set_remote_description_error', function(username, error) {
                print,error('Failed to set remote description for %0!'.f(username.bold()));
            })
            .on('ice_candidate', function(username) {
                print.success('Received ICE Candidate for %0'.f(username.bold()));
            })

            .on('peer_connection_opened', function(username) {
                print.success('Peer connection opened for %0'.f(username.bold()));
            })
            .on('add_remote_stream', function(username) {
                print.success('Remote stream added for %0'.f(username.bold()));
            })
            .on('pc_error', function(username, e) {
                print.error('PeerConnection error when coonecting with %0'.f(username.bold()));
            })

            .on('create_data_channel', function(username) {
                print.operation('DataChannel starting for %0...'.f(username.bold()));
            })
            .on('data_stream_open', function(username) {
                print.success('DataChannel opened for %0.'.f(username.bold()));
            })
            .on('data_stream_close', function(username, channel) {
                print.error('DataChannel closed for %0.'.f(username.bold()));
            });

            var command_lookup = {
                connect: function(server) {
                    if (!/^(http:\/\/|https:\/\/)/.test(server))
                        server = 'http://' + server;
                    rtc.connect(server + '/stream');
                },
                nick: rtc.set_username,
                join: rtc.join_room,
            }

            buffer_input.addEventListener('keydown', function(event) {

                if (event.keyCode != 13)
                    return;
                event.preventDefault();

                var input = buffer_input.value;
                $(buffer_input).val('')
                setTimeout(function() {
                    $(buffer_input).val('')
                },1);
                if (input.length === 0)
                    return;
                if (input[0] === '/') {
                    var command = input.match(/\/(\w+) (.*)/);
                        command_lookup[command[1]](command[2]);
                } else {
                    rtc.send(input);
                }
                return false;
            });

            window.rtc = rtc;
            rtc.connect(document.location.origin + '/stream');
            angular.element('#reloadRooms').click(function(event){
                event.preventDefault();
                $scope.getRooms();
                return false;
            });

        })();

        /**
         * Log service
         * @param  {Object} rtc
         */
        (function(rtc) {

            var pad0 = function(number) { return number < 10 ? '0' + number : number }
            var log = function() {
                var args = Array.prototype.slice.call(arguments, 0);
                var date = new Date();
                args.unshift('%0:%1:%2'.f(
                    pad0(date.getHours()),
                    pad0(date.getMinutes()),
                    pad0(date.getSeconds())));
                console.log.apply(console, args);
                return log;
            }

            rtc.log_data_stream_data = false;
            rtc.log_heartbeat = false;
            rtc.log_event_source_message = true;

            rtc

            .on('error', function(error) {
                log('[ERROR] ' + error);
            })

            // EventSource
            .on('connect', function(stream_url) {
                log('Connected to ' + stream_url);
            })
            .on('connecting', function(stream_url) {
                log('Connecting to ' + stream_url);
            })
            .on('disconnect', function(stream_url) {
                log('Disconnected from ' + stream_url);
            })
            .on('event_source_error', function(event) {
                log('Event source error', event);
            })
            .on('event_source_message', function(event) {
                var data = JSON.parse(event.data);
                if ((data.event === 'heartbeat' && !rtc.log_heartbeat) ||
                    !rtc.log_event_source_message)
                    return;
                log('Event source message', event);
            })
            .on('hello', function() {
                log('Got hello packet!');
            })

            // PeerConnection
            .on('new_peer_connection', function(username, config) {
                log('new PeerConnection for ' + username, config);
            })
            .on('ice_candidate', function(username, candidate, event) {
                log('ICE Candidate ' + username, candidate, event);
            })
            .on('peer_connection_opened', function(username) {
                log('PeerConnection opened for ' + username);
            })
            .on('ice_state_chjange', function(event) {
                log('new ICE state: ' + event.target.iceConnectionState, event);
            })
            .on('add_data_channel', function(username, event) {
                log('Added data cannel for ' + username, event);
            })
            .on('pc_error', function(username, event) {
                log('Peer connection error with ' + username, event);
            })
            .on('set_local_description', function(username) {
                log('Set LocalDescription for ' + username);
            })
            .on('set_local_description_error', function(username, error) {
                log('Set LocalDescription error with ')
            })
            .on('send_offer', function(username) {
                log('Sent PC offer to ' + username);
            })
            .on('send_offer_error', function(username, error) {
                log('PC offer error with ' + username, error);
            })
            .on('receive_offer', function(username, sdp) {
                log('received PC offer from ' + username, sdp);
            })
            .on('receive_answer', function(username, sdp_in) {
                log('received PC answer from ' + username, sdp_in);
            })
            .on('set_remote_description', function(username) {
                log('Set RemoteDescription for '+ username);
            })
            .on('set_remote_description_error', function(username, error) {
                log('RemoteDescription error with ' + username, error);
            })

            // DataChannel
            .on('data_channel_added', function(username, channel, label) {
                log('added DataChannel with %0 labeled "%1"'.f(username, label));
            })
            .on('data_channel_error', function(username, error) {
                log('DataChannel error with %0: %1'.f(username, error));
            })
            .on('data_stream_open', function(username) {
                log('DataChannel opened for ' + username);
            })
            .on('data_stream_close', function(username) {
                log('DataStream closed for ' + username);
            })
            .on('data_stream_data', function(username, message) {
                if (rtc.log_data_stream_data)
                    log('received from %0: %1'.f(username, message));
            })
            .on('data_channel_reliable', function() {
                log('Data channel reliability set to ')
            })
            .on('get_peers', function(data) {
                log('get_peers', data);
            })

            // Chat
            .on('joined_room', function(room) {
                log('joined room: ' + room);
            })
            .on('user_join', function(data) {
                log(data.username + ' has joined the room');
            })
            .on('set_username_success', function(username) {
                log('successfuly set username to ' + username);
            })
            .on('set_username_error', function(username) {
                log('failed to set username to ' + username);
            })

        })(rtc);
    });
})(angular.module('MainCtrl', []));

(function(app) {
    app.factory('Room', function ($http) {
        return {
            getRooms : function() {
              return $http.get('/get_rooms');
            },
        }
    });
})(angular.module('RoomService', []));
