# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

FROM ubuntu:latest

# Install dependencies
RUN apt update && apt install openssh-server rsync sudo -y

# Create directory for sshd
RUN mkdir /var/run/sshd

# Create a user named after the local user and group “sshgroup”
ARG username=sshuser
RUN groupadd sshgroup
RUN useradd -ms /bin/bash -g sshgroup $username

# Create sshuser directory in home
RUN mkdir -p /home/$username/.ssh

# Copy the ssh public key in the authorized_keys file.
#  NOTE: id_ed25519.pub is the public key file name
#    - You will need to copy your id_ed25519 public key into this directory [REPO ROOT]/ssh-server
#    - You will need to add an SSH configuration to your ~/.ssh/config file to use this key
ARG keypath=./id_ed25519.pub
COPY $keypath /home/$username/.ssh/authorized_keys

# change ownership and permissions of the authorized keys file
RUN chown $username:sshgroup /home/$username/.ssh/authorized_keys
RUN chmod 600 /home/$username/.ssh/authorized_keys

ARG datafolder=./data
COPY $datafolder /home/$username/data
RUN chown -R $username:sshgroup /home/$username/data
RUN chmod -R 755 /home/$username/data

# Expose docker port 22
EXPOSE 22

CMD ["/usr/sbin/sshd","-D"]
